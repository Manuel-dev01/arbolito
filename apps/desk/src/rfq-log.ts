/**
 * Stitch's RFQ log lines. At any log level Stitch reports only the RFQs our quote won
 * ("quote result rfq_id=… result=selected"); it doesn't log the requests it answered or lost.
 */
const RESULT = /quote result rfq_id=(\S+) result=([a-z_]+)/;

export function parseRfqResult(line: string): { rfqId: string; result: string } | null {
  const m = RESULT.exec(line);
  return m ? { rfqId: m[1]!, result: m[2]! } : null;
}
