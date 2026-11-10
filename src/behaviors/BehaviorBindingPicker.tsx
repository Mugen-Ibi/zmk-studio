import { useEffect, useId, useMemo, useState } from "react";
import {
  GetBehaviorDetailsResponse,
  BehaviorBindingParametersSet,
} from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { BehaviorParametersPicker } from "./BehaviorParametersPicker";
import { validateValue } from "./parameters";
export interface BehaviorBindingPickerProps {
  binding: BehaviorBinding;
  behaviors: GetBehaviorDetailsResponse[];
  layers: { id: number; name: string }[];
  onBindingChanged: (binding: BehaviorBinding) => void;
}
type Draft = { behaviorId: number; param1?: number; param2?: number };
function validateBinding(
  metadata: BehaviorBindingParametersSet[],
  layerIds: number[],
  param1?: number,
  param2?: number,
) {
  if (metadata.length === 0) return (param1 ?? 0) === 0 && (param2 ?? 0) === 0;
  return metadata.some(
    (set) =>
      validateValue(layerIds, param1, set.param1) &&
      validateValue(layerIds, param2, set.param2),
  );
}
export const BehaviorBindingPicker = ({
  binding,
  layers,
  behaviors,
  onBindingChanged,
}: BehaviorBindingPickerProps) => {
  const [draft, setDraft] = useState<Draft>(binding);
  const id = useId();
  useEffect(() => setDraft(binding), [binding]);
  const metadata = behaviors.find((b) => b.id === draft.behaviorId)?.metadata;
  const sorted = useMemo(
    () =>
      [...behaviors].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [behaviors],
  );
  const change = (next: Draft, normalize = false) => {
    const sets = behaviors.find((b) => b.id === next.behaviorId)?.metadata;
    const ids = layers.map((l) => l.id);
    if (sets && normalize) {
      const set = sets.find((s) => validateValue(ids, next.param1, s.param1));
      if (!set?.param2.length || set.param2.every((v) => v.nil))
        next.param2 = 0;
      else if (!validateValue(ids, next.param2, set.param2))
        next.param2 = undefined;
    }
    setDraft(next);
    if (sets && validateBinding(sets, ids, next.param1, next.param2)) {
      onBindingChanged({
        behaviorId: next.behaviorId,
        param1: next.param1 ?? 0,
        param2: next.param2 ?? 0,
      });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <label htmlFor={id}>Behavior: </label>
        <select
          id={id}
          value={draft.behaviorId}
          className="h-8 rounded"
          onChange={(e) =>
            change(
              { behaviorId: Number(e.target.value), param1: 0, param2: 0 },
              true,
            )
          }
        >
          {sorted.map((b) => (
            <option key={b.id} value={b.id}>
              {b.displayName}
            </option>
          ))}
        </select>
      </div>
      {metadata && (
        <BehaviorParametersPicker
          metadata={metadata}
          param1={draft.param1}
          param2={draft.param2}
          layers={layers}
          onParam1Changed={(param1) => change({ ...draft, param1 }, true)}
          onParam2Changed={(param2) => change({ ...draft, param2 })}
        />
      )}
    </div>
  );
};
