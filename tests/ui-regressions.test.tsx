import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { BehaviorBindingPicker } from "../src/behaviors/BehaviorBindingPicker";
import { ParameterValuePicker } from "../src/behaviors/ParameterValuePicker";
import { HidUsagePicker } from "../src/behaviors/HidUsagePicker";
import { validateValue } from "../src/behaviors/parameters";
import { bindingSummary } from "../src/keyboard/bindingSummary";
import { dropDestination } from "../src/keyboard/reorder";
import { useModalRef } from "../src/misc/useModalRef";
import { enumerateDevices } from "../src/tauri/enumerate";
import { Download } from "../src/DownloadPage";
import { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { Layer } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { keyPress, layer } from "./mouse-metadata";
import { layoutBounds } from "../src/keyboard/geometry";
import { PhysicalLayout } from "../src/keyboard/PhysicalLayout";
import { deserializeLayoutZoom } from "../src/keyboard/layoutZoom";
import { publish, useSub } from "../src/usePubSub";

it("bounds stalled device discovery and retains the other transport for retry", async () => {
  vi.useFakeTimers();
  try {
    const pending = enumerateDevices([
      {
        label: "BLE",
        pick_and_connect: {
          list: () => new Promise(() => {}),
          connect: vi.fn(),
        },
      },
      {
        label: "USB",
        pick_and_connect: {
          list: async () => [{ id: "COM1", label: "Keyboard" }],
          connect: vi.fn(),
        },
      },
    ]);
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.devices).toHaveLength(1);
    expect(result.errors).toEqual(["BLE: Device discovery timed out"]);
  } finally {
    vi.useRealTimers();
  }
});
it("drops an already queued notification from a disconnected session", async () => {
  const callback = vi.fn();
  function Subscriber() {
    useSub("rpc_notification.keymap.unsavedChangesStatusChanged", callback);
    return null;
  }
  render(<Subscriber />);
  const controller = new AbortController();
  const pending = publish(
    "rpc_notification.keymap.unsavedChangesStatusChanged",
    true,
    controller.signal,
  );
  controller.abort();
  await pending;
  expect(callback).not.toHaveBeenCalled();
});
it("includes negative rotated corners and honors an explicit zero pivot", () => {
  const bounds = layoutBounds([
    { x: 1, y: 0, width: 2, height: 1, r: 90, rx: 0, ry: 0 },
  ]);
  expect(bounds.x).toBeCloseTo(-1);
  expect(bounds.y).toBeCloseTo(1);
  expect(bounds.width).toBeCloseTo(1);
  expect(bounds.height).toBeCloseTo(2);
  render(
    <PhysicalLayout
      hoverZoom={false}
      positions={[{ id: "a", x: 0, y: 0, width: 1, height: 1, children: "A" }]}
    />,
  );
  expect(screen.getByRole("button").className).not.toContain("hover:scale-125");
  expect(screen.getByRole("button").hasAttribute("hoverZoom")).toBe(false);
});
it("rejects corrupt stored zoom values", () => {
  for (const value of ["-1", "Infinity", "2bad", "0", ""])
    expect(deserializeLayoutZoom(value)).toBe("auto");
  expect(deserializeLayoutZoom("1.5")).toBe(1.5);
});
it("edits mixed metadata alternatives while exposing invalid values", () => {
  const changed = vi.fn();
  render(
    <ParameterValuePicker
      layers={[]}
      value={8}
      values={[
        { name: "Off", constant: 0 },
        { name: "Delay", range: { min: 10, max: 20 } },
      ]}
      onValueChanged={changed}
    />,
  );
  const input = screen.getByRole("spinbutton");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(input, { target: { value: "12" } });
  expect(changed).toHaveBeenCalledWith(12);
});

it("normalizes hidden param2 and requires a new selection when a changed range excludes it", () => {
  const bt = GetBehaviorDetailsResponse.fromPartial({
    id: 1,
    displayName: "Bluetooth",
    metadata: [
      {
        param1: [{ name: "Select", constant: 0 }],
        param2: [{ name: "Profile", range: { min: 0, max: 4 } }],
      },
      { param1: [{ name: "Next", constant: 1 }], param2: [] },
      {
        param1: [{ name: "Other", constant: 2 }],
        param2: [{ name: "Value", range: { min: 5, max: 7 } }],
      },
    ],
  });
  const changed = vi.fn();
  render(
    <BehaviorBindingPicker
      behaviors={[bt]}
      binding={{ behaviorId: 1, param1: 0, param2: 3 }}
      layers={[]}
      onBindingChanged={changed}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Parameter value" }), {
    target: { value: "1" },
  });
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(changed).toHaveBeenLastCalledWith({
    behaviorId: 1,
    param1: 1,
    param2: 0,
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Parameter value" }), {
    target: { value: "2" },
  });
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("");
  expect(changed).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "6" } });
  expect(changed).toHaveBeenLastCalledWith({
    behaviorId: 1,
    param1: 2,
    param2: 6,
  });
});
it.each([0x70004, 0x01070004, 0x80070004])(
  "accepts supported HID including unsigned modifiers: %s",
  (value) => {
    expect(
      validateValue([], value, [
        { name: "Key", hidUsage: { keyboardMax: 4, consumerMax: 0 } },
      ]),
    ).toBe(true);
  },
);
it.each([0, 0x70005, 0xc0001, 0x90001, NaN, -1])(
  "rejects unsupported HID: %s",
  (value) => {
    expect(
      validateValue([], value, [
        { name: "Key", hidUsage: { keyboardMax: 4, consumerMax: 0 } },
      ]),
    ).toBe(false);
  },
);
it("hides the consumer page when its maximum is zero and labels each picker independently", async () => {
  render(
    <>
      <HidUsagePicker
        label="Hold"
        usagePages={[{ id: 12, max: 0 }]}
        onValueChanged={() => {}}
      />
      <HidUsagePicker
        label="Tap"
        usagePages={[{ id: 7, min: 4, max: 4 }]}
        onValueChanged={() => {}}
      />
    </>,
  );
  const hold = screen.getByRole("combobox", { name: "Hold:" });
  expect(screen.getByRole("combobox", { name: "Tap:" })).not.toBe(hold);
  await userEvent.click(hold);
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.queryByRole("option", { name: /Volume Increment/ })).toBeNull();
});
it.each([
  { layers: [] },
  {
    layers: [
      { id: 3, name: "Three" },
      { id: 4, name: "Four" },
    ],
  },
])("does not misrepresent a missing layer ID", ({ layers }) => {
  const changed = vi.fn();
  render(
    <ParameterValuePicker
      value={0}
      values={[{ name: "Layer", layerId: {} }]}
      layers={layers}
      onValueChanged={changed}
    />,
  );
  expect(
    (screen.getByRole("combobox", { name: "Layer:" }) as HTMLSelectElement)
      .value,
  ).toBe("");
  expect(changed).not.toHaveBeenCalled();
});
it("distinguishes modifiers, layers, second arguments and unknown metadata", () => {
  const layers = [
    Layer.fromPartial({ id: 1, name: "One" }),
    Layer.fromPartial({ id: 3, name: "Three" }),
  ];
  const a = { behaviorId: 7, param1: 0x70004, param2: 0 };
  expect(bindingSummary(a, keyPress, layers)).toBe("A");
  expect(bindingSummary({ ...a, param1: 0x01070004 }, keyPress, layers)).toBe(
    "L Ctrl+A",
  );
  expect(
    bindingSummary({ behaviorId: 9, param1: 3, param2: 0 }, layer, layers),
  ).toBe("Layer Three");
  const ht = {
    ...keyPress,
    metadata: [
      {
        param1: keyPress.metadata[0].param1,
        param2: keyPress.metadata[0].param1,
      },
    ],
  };
  expect(bindingSummary({ ...a, param2: 0x70005 }, ht, layers)).toBe("A / B");
  expect(bindingSummary({ ...a, param2: 3 }, undefined, layers)).toBe(
    "458756 / 3",
  );
});
it.each([
  [0, 1, "before", 0],
  [0, 1, "after", 1],
  [2, 0, "before", 0],
  [2, 0, "after", 1],
  [0, 2, "after", 2],
  [1, 1, "before", 1],
  [1, 1, "after", 1],
  [2, 1, "after", 2],
] as const)(
  "calculates final drop index %s %s %s",
  (start, target, position, expected) => {
    expect(dropDestination(start, target, position)).toBe(expected);
  },
);
it("keeps USB available after BLE enumeration fails", async () => {
  const usb = vi.fn(async () => [{ id: "COM3", label: "Keyboard" }]);
  const connect = vi.fn();
  const result = await enumerateDevices([
    {
      label: "BLE",
      pick_and_connect: {
        list: async () => {
          throw Error("offline");
        },
        connect,
      },
    },
    { label: "USB", pick_and_connect: { list: usb, connect } },
  ]);
  expect(usb).toHaveBeenCalled();
  expect(result.devices[0].device.id).toBe("COM3");
  expect(result.errors).toEqual(["BLE: offline"]);
});
it("does not accumulate modal cancellation handlers or delayed reopen", () => {
  function Modal({ open }: { open: boolean }) {
    return <dialog ref={useModalRef(open, false, false)}>Test</dialog>;
  }
  const view = render(<Modal open />);
  const dialog = screen.getByText("Test");
  for (let i = 0; i < 4; i++) {
    view.rerender(<Modal open={false} />);
    view.rerender(<Modal open />);
  }
  const event = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  view.rerender(<Modal open={false} />);
  const closedEvent = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(closedEvent);
  expect(closedEvent.defaultPrevented).toBe(false);
});
it("renders only provided downloads and links to the fork release", () => {
  render(<Download />);
  expect(screen.queryByText(/Download for Windows \(msi\)/)).toBeNull();
  const links = screen.getAllByRole("link") as HTMLAnchorElement[];
  expect(links.length).toBeGreaterThan(0);
  expect(
    links.every((link) =>
      link.href.includes("github.com/Mugen-Ibi/zmk-studio/releases"),
    ),
  ).toBe(true);
});
