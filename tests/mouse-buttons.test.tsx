import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { BehaviorBindingPicker } from "../src/behaviors/BehaviorBindingPicker";
import { ParameterValuePicker } from "../src/behaviors/ParameterValuePicker";
import { validateValue } from "../src/behaviors/parameters";
import { mouse, keyPress, layer } from "./mouse-metadata";

const layers = [
  { id: 0, name: "Base" },
  { id: 3, name: "Symbols" },
];

describe("firmware-provided mouse constants", () => {
  it("decodes all five masks and normalizes omitted metadata to an empty array", () => {
    const decoded = GetBehaviorDetailsResponse.decode(
      GetBehaviorDetailsResponse.encode(mouse).finish(),
    );
    expect(decoded.metadata[0].param1.map((v) => v.constant)).toEqual([
      1, 2, 4, 8, 16,
    ]);
    expect(
      GetBehaviorDetailsResponse.decode(new Uint8Array()).metadata,
    ).toEqual([]);
  });

  it.each([undefined, 0, 3, 32])(
    "does not display MB1 as selected for invalid value %s",
    (value) => {
      const changed = vi.fn();
      render(
        <ParameterValuePicker
          values={mouse.metadata[0].param1}
          value={value}
          layers={layers}
          onValueChanged={changed}
        />,
      );
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("");
      expect(select.selectedOptions[0].textContent).toBe("Select a value");
      expect(changed).not.toHaveBeenCalled();
      fireEvent.change(select, { target: { value: "1" } });
      expect(changed).toHaveBeenCalledWith(1);
    },
  );

  it("selects a mouse behavior without sending 0, then changes every button", async () => {
    const changed = vi.fn();
    render(
      <BehaviorBindingPicker
        binding={{ behaviorId: 7, param1: 0x70004, param2: 0 }}
        behaviors={[keyPress, mouse]}
        layers={layers}
        onBindingChanged={changed}
      />,
    );
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "42" },
    });
    expect(changed).not.toHaveBeenCalled();
    const select = screen.getAllByRole("combobox")[1];
    for (const value of [1, 2, 4, 8, 16]) {
      fireEvent.change(select, { target: { value: String(value) } });
      await waitFor(() =>
        expect(changed).toHaveBeenLastCalledWith({
          behaviorId: 42,
          param1: value,
          param2: 0,
        }),
      );
    }
  });

  it("keeps a legacy binding intact without inventing metadata or emitting changes", () => {
    const changed = vi.fn();
    render(
      <BehaviorBindingPicker
        binding={{ behaviorId: 42, param1: 4, param2: 0 }}
        behaviors={[{ ...mouse, metadata: [] }]}
        layers={layers}
        onBindingChanged={changed}
      />,
    );
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "MB1" })).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(validateValue([0, 3], 4, [])).toBe(false);
  });

  it("preserves zero-valued constants and normal layer editing", () => {
    const changed = vi.fn();
    const view = render(
      <ParameterValuePicker
        values={[{ name: "Off", constant: 0 }]}
        value={0}
        layers={layers}
        onValueChanged={changed}
      />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("0");
    view.unmount();
    render(
      <BehaviorBindingPicker
        binding={{ behaviorId: 9, param1: 0, param2: 0 }}
        behaviors={[layer]}
        layers={layers}
        onBindingChanged={changed}
      />,
    );
    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "3" },
    });
    expect(changed).toHaveBeenLastCalledWith({
      behaviorId: 9,
      param1: 3,
      param2: 0,
    });
    expect(validateValue([0, 3], 2, layer.metadata[0].param1)).toBe(false);
  });

  it("continues to accept ordinary and modified HID keys and rejects invalid mouse masks", () => {
    for (const value of [0x70004, 0x01070004, 0x700e1]) {
      expect(validateValue([0, 3], value, keyPress.metadata[0].param1)).toBe(
        true,
      );
    }
    for (const value of [0, 3, 5, 32]) {
      expect(validateValue([0, 3], value, mouse.metadata[0].param1)).toBe(
        false,
      );
    }
  });

  it("keeps the HID picker and modifier edits working", async () => {
    const changed = vi.fn();
    render(
      <BehaviorBindingPicker
        binding={{ behaviorId: 7, param1: 0x70004, param2: 0 }}
        behaviors={[keyPress, mouse]}
        layers={layers}
        onBindingChanged={changed}
      />,
    );
    const input = screen.getAllByRole("combobox")[1] as HTMLInputElement;
    expect(input.value).toContain("A");
    await userEvent.click(screen.getByRole("checkbox", { name: "L Ctrl" }));
    expect(changed).toHaveBeenLastCalledWith({
      behaviorId: 7,
      param1: 0x01070004,
      param2: 0,
    });
  });
});
