import {saleStaff} from './saleStaff';
const labels={saleStaff:'Sold by',saleAdmin:'Admin',saleCashier:'Cashier'};
const c=key=>labels[key]||key;
test('attributes a completed sale to the checkout operator instead of its creator',()=>{
 expect(saleStaff({status:'COMPLETED',actorName:'Mostafa',actorRole:'CASHIER',completedName:'Rabee',completedRole:'OWNER'},c)).toEqual({name:'Rabee',label:'Admin'});
});
test('shows cashier and draft-creator identities',()=>{
 expect(saleStaff({status:'COMPLETED',completedName:'Mostafa',completedRole:'CASHIER'},c)).toEqual({name:'Mostafa',label:'Cashier'});
 expect(saleStaff({status:'DRAFT',actorName:'Rabee',actorRole:'OWNER'},c)).toEqual({name:'Rabee',label:'Admin'});
});
test('does not guess historical roles or substitute the creator role for a different checkout operator',()=>{
 expect(saleStaff({status:'COMPLETED',actorName:'Mostafa',actorRole:'CASHIER',completedName:'Rabee'},c)).toEqual({name:'Rabee',label:'Sold by'});
 expect(saleStaff({status:'CANCELLED',actorName:'Former employee'},c)).toEqual({name:'Former employee',label:'Sold by'});
});
