import {buildStructuredData, serializeStructuredData} from './structuredData';
const base = {siteUrl:'https://profitendo.com', title:'ProfitLens', description:'Recorded business reports'};

test('links public page, website, organization and app identities on the canonical origin', () => {
  const schema = buildStructuredData({...base, path:'/features', lang:'en'});
  const byType = Object.fromEntries(schema['@graph'].map(node => [node['@type'], node]));
  expect(schema['@context']).toBe('https://schema.org');
  expect(byType.WebPage.url).toBe('https://profitendo.com/features');
  expect(byType.WebPage.inLanguage).toBe('en');
  expect(byType.WebPage.about['@id']).toBe(byType.WebApplication['@id']);
  expect(byType.WebPage.isPartOf['@id']).toBe(byType.WebSite['@id']);
  expect(byType.WebApplication.publisher['@id']).toBe(byType.Organization['@id']);
  expect(byType.Organization.email).toBe('profitlens.team@gmail.com');
});

test('does not attach public product schema to private, unsupported, or external paths', () => {
  for (const path of ['/business-v2','/auth','/contact','/missing','https://example.test/','/pricing?token=secret']) {
    expect(buildStructuredData({...base,path})).toBeNull();
  }
});

test('uses the organization as the About page subject and avoids invented commercial claims', () => {
  const about = buildStructuredData({...base,path:'/about',lang:'ar'});
  const page = about['@graph'].find(node => node['@type']==='AboutPage');
  expect(page.inLanguage).toBe('ar');
  expect(page.about['@id']).toBe('https://profitendo.com/#organization');
  for (const path of ['/','/features','/pricing','/about']) {
    const text = JSON.stringify(buildStructuredData({...base,path}));
    expect(text).not.toMatch(/aggregateRating|review|priceCurrency|offers|SearchAction|FAQPage/);
  }
});

test('safely serializes text that could otherwise close a JSON-LD script tag', () => {
  const title='ProfitLens </script><script>alert(1)</script>';
  const schema=buildStructuredData({...base,title});
  const serialized=serializeStructuredData(schema);
  expect(serialized).not.toContain('<');
  expect(JSON.parse(serialized)).toEqual(schema);
});


test('English page identities match their crawlable locale URLs', () => {
  for (const path of ['/en','/en/features','/en/pricing','/en/about']) {
    const schema=buildStructuredData({...base,path,lang:'en'});
    const page=schema['@graph'].find(node=>['WebPage','AboutPage'].includes(node['@type']));
    expect(page.url).toBe(`https://profitendo.com${path}`);
    expect(page.inLanguage).toBe('en');
  }
  expect(buildStructuredData({...base,path:'/en/business-v2'})).toBeNull();
});
