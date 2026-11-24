export default function ProductEntryHelp({lang,canCreate,compact=false}) {
  const ar=lang==='ar';
  const content=<aside className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 space-y-2" data-testid="product-entry-help">
    {!compact&&<p className="font-semibold">{ar?'المنتج غير موجود؟':'Product not listed?'}</p>}
    <p>{canCreate
      ? (ar?'من القائمة الرئيسية افتح «المنتجات» ثم «إضافة منتج»، وأدخل بياناته واحفظه. ارجع إلى نفس النموذج في المشتريات، وابحث عن المنتج الجديد واختره من النتائج.':'From the main menu, open Products → Add product, enter its details and save. Return to the same form in Purchases, search for the new product and select it from the results.')
      : (ar?'اطلب من صاحب النشاط أو موظف لديه صلاحية إضافة المنتجات إنشاء المنتج أولاً. بعدها ابحث عن المنتج واختره من النتائج.':'Ask the business owner or a staff member with product-creation permission to add it first. Then search for the product and select it from the results.')}</p>
    <p className="text-xs text-slate-500">{ar?'إضافة المنتج تحفظ بياناته فقط. كمية المخزون تُضاف عند تأكيد الاستلام.':'Adding a product saves its details only. Stock quantity increases when receiving is confirmed.'}</p>
  </aside>;
  return compact?<details className="text-sm text-slate-600"><summary className="w-fit cursor-pointer rounded text-emerald-700 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">{ar?'المنتج غير موجود؟':'Product not listed?'}</summary><div className="mt-3">{content}</div></details>:content;
}
