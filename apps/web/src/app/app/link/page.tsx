import { MiniApp } from "../../../components/miniapp/MiniApp";

/** /app/link?code=1234: confirm the 4-digit Telegram linking code with one tap. */
export default function LinkPage() {
  return <MiniApp mode="link" />;
}
