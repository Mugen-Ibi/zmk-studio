// Modified by Mugen-Ibi: show unselected metadata constants explicitly.
import { BehaviorParameterValueDescription } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { useId } from "react";
import { validateValue } from "./parameters";
import { HidUsagePicker } from "./HidUsagePicker";

export interface ParameterValuePickerProps {
  value?: number;
  values: BehaviorParameterValueDescription[];
  layers: { id: number; name: string }[];
  onValueChanged: (value?: number) => void;
}

export const ParameterValuePicker = ({
  value,
  values,
  layers,
  onValueChanged,
}: ParameterValuePickerProps) => {
  const id = useId();
  if (values.length == 0 || values.every((v) => v.nil)) {
    return <></>;
  } else if (values.every((v) => v.constant !== undefined)) {
    const hasValue = values.some((v) => v.constant === value);
    return (
      <div>
        <select
          aria-label="Parameter value"
          value={hasValue ? value : ""}
          className="h-8 rounded"
          onChange={(e) => onValueChanged(parseInt(e.target.value))}
        >
          {!hasValue && (
            <option value="" disabled>
              Select a value
            </option>
          )}
          {values.map((v) => (
            <option key={v.constant} value={v.constant}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
    );
  } else if (values.length == 1) {
    if (values[0].range) {
      return (
        <div>
          <label htmlFor={id}>{values[0].name}: </label>
          <input
            id={id}
            type="number"
            min={values[0].range.min}
            max={values[0].range.max}
            value={value ?? ""}
            onChange={(e) => onValueChanged(parseInt(e.target.value))}
          />
        </div>
      );
    } else if (values[0].hidUsage) {
      return (
        <HidUsagePicker
          onValueChanged={onValueChanged}
          label={values[0].name}
          value={value}
          usagePages={[
            { id: 7, min: 4, max: values[0].hidUsage.keyboardMax },
            { id: 12, max: values[0].hidUsage.consumerMax },
          ]}
        />
      );
    } else if (values[0].layerId) {
      return (
        <div>
          <label htmlFor={id}>{values[0].name}: </label>
          <select
            id={id}
            value={layers.some((l) => l.id === value) ? value : ""}
            className="h-8 rounded"
            onChange={(e) => onValueChanged(parseInt(e.target.value))}
          >
            <option value="" disabled>
              Select a layer
            </option>
            {layers.map(({ name, id }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      );
    }
  }
  // Mixed metadata alternatives have a shared unsigned integer wire value.
  return (
    <div>
      <label htmlFor={id}>Parameter value: </label>
      <input
        id={id}
        type="number"
        min={0}
        max={0xffffffff}
        step={1}
        value={value ?? ""}
        aria-invalid={
          value !== undefined &&
          !validateValue(
            layers.map((l) => l.id),
            value,
            values,
          )
        }
        aria-describedby={id + "-help"}
        onChange={(e) =>
          onValueChanged(
            e.target.value === "" ? undefined : Number(e.target.value),
          )
        }
      />
      <p id={id + "-help"} className="text-sm">
        {values
          .map((v) =>
            v.constant !== undefined
              ? `${v.name}: ${v.constant}`
              : v.range
                ? `${v.name}: ${v.range.min}–${v.range.max}`
                : v.name,
          )
          .join("; ")}
      </p>
    </div>
  );
};
