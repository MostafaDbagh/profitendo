import {currencyFormatter} from './currencyFormat';
test.each(['ar','en'])('currency labels in %s',locale=>{
 const dollars=currencyFormatter(locale,{style:'currency',currency:'USD'}).format(123.45);
 expect(dollars).toContain('$');expect(dollars).not.toMatch(/USD|US\$/);
 expect(currencyFormatter(locale,{style:'currency',currency:'SYP'}).format(123)).toContain('SYP');
});
