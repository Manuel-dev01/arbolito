"use client";

import type { Screen } from "../screens";
import { useApp } from "../context";
import { Gate } from "./Gate";
import { AddMoney, AddRipio, AddWaiting, DoneOnboarding, Welcome } from "./Onboarding";
import { Home } from "./Home";
import { ChatScreen } from "./Chat";
import { Alts, Cancelled, ChangeScreen, Done, Failed, NoMarket, Processing, QuoteLoading, QuoteScreen, TgQuote } from "./Change";
import { SendAdd, SendAmount, SendDone, SendList, SendQuote } from "./Send";
import { AutoConsent, AutoContacts, AutoIntro, AutoLimits, AutoOn } from "./Autonomy";
import { Revoke, Security, Settings, Withdraw } from "./Account";
import { ReceiptDetail, ReceiptsList } from "./Receipts";

export function ScreenView({ screen }: { screen: Screen }) {
  const { t } = useApp();
  switch (screen) {
    case "no-minipay":
    case "conn-fail":
      return <Gate kind={screen} t={t} onRetry={() => window.location.reload()} />;
    case "welcome":
      return <Welcome />;
    case "add":
      return <AddMoney />;
    case "add-ripio":
      return <AddRipio />;
    case "add-waiting":
      return <AddWaiting />;
    case "done-ob":
      return <DoneOnboarding />;
    case "home":
      return <Home />;
    case "chat":
      return <ChatScreen />;
    case "change":
      return <ChangeScreen />;
    case "quote-loading":
      return <QuoteLoading />;
    case "quote":
    case "quote-expired":
    case "quote-changed":
      return <QuoteScreen />;
    case "quote-nomarket":
      return <NoMarket />;
    case "alts":
      return <Alts />;
    case "processing":
      return <Processing />;
    case "done":
      return <Done />;
    case "failed":
      return <Failed />;
    case "cancelled":
      return <Cancelled />;
    case "tg-quote":
      return <TgQuote />;
    case "send":
      return <SendList />;
    case "send-add":
      return <SendAdd />;
    case "send-amount":
      return <SendAmount />;
    case "send-quote":
      return <SendQuote />;
    case "send-done":
      return <SendDone />;
    case "auto-intro":
      return <AutoIntro />;
    case "auto-limits":
      return <AutoLimits />;
    case "auto-contacts":
      return <AutoContacts />;
    case "auto-consent":
      return <AutoConsent />;
    case "auto-on":
      return <AutoOn />;
    case "security":
      return <Security />;
    case "revoke":
      return <Revoke />;
    case "receipts":
      return <ReceiptsList />;
    case "receipt":
      return <ReceiptDetail />;
    case "settings":
      return <Settings />;
    case "withdraw":
      return <Withdraw />;
  }
}
