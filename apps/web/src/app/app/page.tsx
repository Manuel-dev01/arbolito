import { MiniApp } from "../../components/miniapp/MiniApp";

/**
 * The MiniPay Mini App. Everything is client-side: the wallet is MiniPay's injected provider.
 * ?mock=1 serves fixtures and a stand-in MiniPay sheet; ?state=<screen> jumps to a screen.
 */
export default function MiniAppPage() {
  return <MiniApp />;
}
