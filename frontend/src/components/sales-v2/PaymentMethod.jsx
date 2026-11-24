import MethodFields from '../business-v2/PaymentMethod';

export const needsReference = method => ['TRANSFER','CARD','OTHER'].includes(method);
export default function PaymentMethod({c, ...props}) {
  return <MethodFields id="sale-method" detailId="sale-payment-reference" {...props}
    referenceLabel={needsReference(props.method) ? c('salePaymentReference') : undefined}/>;
}
