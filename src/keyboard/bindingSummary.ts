import type {
  BehaviorBinding,
  Layer,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type {
  BehaviorParameterValueDescription,
  GetBehaviorDetailsResponse,
} from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { hid_usage_get_labels } from "../hid-usages";
import { validateValue } from "../behaviors/parameters";
const modifiers = [
  "L Ctrl",
  "L Shift",
  "L Alt",
  "L GUI",
  "R Ctrl",
  "R Shift",
  "R Alt",
  "R GUI",
];
export function hidSummary(value: number) {
  const labels = hid_usage_get_labels((value >>> 16) & 0xff, value & 0xffff);
  const key = (
    labels.short ??
    labels.med ??
    labels.long ??
    `0x${(value & 0xffffff).toString(16)}`
  ).replace(/^Keyboard /, "");
  return [...modifiers.filter((_, i) => (value >>> 24) & (1 << i)), key].join(
    "+",
  );
}
function parameter(
  value: number,
  descriptions: BehaviorParameterValueDescription[] | undefined,
  layers: Layer[],
) {
  const description = descriptions?.find((v) =>
    validateValue(
      layers.map((l) => l.id),
      value,
      [v],
    ),
  );
  if (description?.constant !== undefined)
    return description.name || String(value);
  if (description?.hidUsage) return hidSummary(value);
  if (description?.layerId)
    return `Layer ${layers.find((l) => l.id === value)?.name || value}`;
  if (description?.nil || descriptions?.length === 0) return "";
  return String(value);
}
export function bindingSummary(
  binding: BehaviorBinding,
  behavior: GetBehaviorDetailsResponse | undefined,
  layers: Layer[],
) {
  const set = behavior?.metadata.find((s) =>
    validateValue(
      layers.map((l) => l.id),
      binding.param1,
      s.param1,
    ),
  );
  if (!set) return `${binding.param1} / ${binding.param2}`;
  return [
    parameter(binding.param1, set.param1, layers),
    parameter(binding.param2, set.param2, layers),
  ]
    .filter(Boolean)
    .join(" / ");
}
