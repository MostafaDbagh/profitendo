import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { toast } from "sonner";
import { useLanguage } from "../context/LanguageContext";

const CLIENT_ID = process.env.REACT_APP_PAYPAL_CLIENT_ID;

export const PayPalSubscribeButton = ({ planId, onApproved, testid }) => {
  const { t } = useLanguage();
  if (!CLIENT_ID || !planId) return null;
  return (
    <div data-testid={testid}>
      <PayPalScriptProvider options={{ clientId: CLIENT_ID, vault: true, intent: "subscription" }}>
        <PayPalButtons
          style={{ shape: "rect", color: "gold", layout: "vertical", label: "subscribe" }}
          createSubscription={(data, actions) => actions.subscription.create({ plan_id: planId })}
          onApprove={async (data) => {
            if (data.subscriptionID) onApproved(data.subscriptionID);
          }}
          onError={() => toast.error(t("somethingWrong"))}
        />
      </PayPalScriptProvider>
    </div>
  );
};
