import PaymentMethod from '../business-v2/PaymentMethod';

export function initialPurchaseTerms(document) {
  return {method:document ? document.paymentMethod ?? '' : 'CASH', description:document?.paymentDescription ?? ''};
}

export default function PurchasePayment({terms, onChange, ...props}) {
  return <PaymentMethod id="purchase-method" detailId="purchase-payment-description" {...props}
    method={terms.method} reference={terms.description}
    onMethod={method=>onChange({method,description:''})}
    onReference={description=>onChange({...terms,description})}/>;
}
