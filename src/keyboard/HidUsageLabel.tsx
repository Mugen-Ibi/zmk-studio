import { hidSummary } from "./bindingSummary";
export interface HidUsageLabelProps {
  hid_usage: number;
}
export const HidUsageLabel = ({ hid_usage }: HidUsageLabelProps) => (
  <span>{hidSummary(hid_usage)}</span>
);
