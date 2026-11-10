import { BehaviorParameterValueDescription } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
export function hidUsageInRange(
  page: number,
  id: number,
  min = 1,
  max = 0xffff,
) {
  if (id === 0 || max === 0) return false;
  return (id >= min && id <= max) || (page === 7 && id >= 0xe0 && id <= 0xe7);
}
export function validateValue(
  layerIds: number[],
  value?: number,
  values?: BehaviorParameterValueDescription[],
): boolean {
  if (!values?.length) return value === undefined || value === 0;
  if (value === undefined) return values.some((v) => v.nil);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return false;
  return values.some((v) => {
    if (v.constant !== undefined) return v.constant === value;
    if (v.range) return value >= v.range.min && value <= v.range.max;
    if (v.hidUsage) {
      const page = (value >>> 16) & 0xff;
      const id = value & 0xffff;
      if (page === 7)
        return hidUsageInRange(page, id, 4, v.hidUsage.keyboardMax);
      if (page === 12)
        return hidUsageInRange(page, id, 1, v.hidUsage.consumerMax);
      return false;
    }
    if (v.layerId) return layerIds.includes(value);
    return !!v.nil && value === 0;
  });
}
