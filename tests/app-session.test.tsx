import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import App from "../src/App";
import { fakeDevice } from "./fake-device";

async function connected(device = fakeDevice()) {
  const view = render(
    <App
      transports={[
        { label: "Fake USB", connect: async () => device.transport },
      ]}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Fake USB" }));
  await screen.findByRole("button", { name: "A" });
  return { device, view };
}
async function editMouse() {
  await userEvent.click(screen.getByRole("button", { name: "A" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Behavior:" }), {
    target: { value: "42" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Parameter value" }), {
    target: { value: "2" },
  });
  await screen.findByRole("button", { name: /MB2/ });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
it("uses real App, Undo and framed transport for editing, rejected save/discard, undo/redo and saving", async () => {
  const { device } = await connected();
  await editMouse();
  device.fail.save = true;
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(device.saved.layers[0].bindings[0].behaviorId).toBe(7);
  expect(
    (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  device.fail.discard = true;
  await userEvent.click(screen.getByRole("button", { name: "Discard" }));
  await screen.findByText("The device could not discard changes");
  expect(
    (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await screen.findByRole("button", { name: "A" });
  await userEvent.click(screen.getByRole("button", { name: "Redo" }));
  await screen.findByRole("button", { name: /MB2/ });
  device.fail.save = false;
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(device.saved.layers[0].bindings[0].param1).toBe(2),
  );
  expect(device.requests.filter((r) => r.keymap?.saveChanges)).toHaveLength(2);
});
it("clears history on reconnect and ignores old connection termination", async () => {
  const a = fakeDevice("A device");
  const b = fakeDevice("B device");
  let current = a;
  render(
    <App
      transports={[
        { label: "Fake USB", connect: async () => current.transport },
      ]}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Fake USB" }));
  await screen.findByRole("button", { name: "A" });
  await editMouse();
  await act(async () => a.end());
  current = b;
  await userEvent.click(
    await screen.findByRole("button", { name: "Fake USB" }),
  );
  await screen.findByRole("button", { name: "B device" });
  await screen.findByRole("button", { name: "A" });
  expect(
    (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () => a.end());
  expect(screen.getByRole("button", { name: "B device" })).toBeTruthy();
  expect(b.requests.filter((r) => r.keymap?.setLayerBinding)).toHaveLength(0);
});
it("removes a layer immediately after the initial load without changing selection", async () => {
  const { device } = await connected();
  await userEvent.click(screen.getByRole("button", { name: "Remove layer" }));
  await waitFor(() =>
    expect(
      device.requests.some((r) => r.keymap?.removeLayer?.layerIndex === 0),
    ).toBe(true),
  );
  expect(device.working.layers.map((l) => l.id)).toEqual([3]);
});
it("keeps physical layout and undo unchanged on rejection, then supports successful switch and undo", async () => {
  const { device } = await connected();
  device.fail.layout = true;
  await userEvent.click(screen.getByRole("button", { name: /Layout/ }));
  await userEvent.click(
    await screen.findByRole("option", { name: "Alternative" }),
  );
  await screen.findByText("The device rejected the physical layout");
  expect(device.activeLayout).toBe(0);
  expect(
    (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  device.fail.layout = false;
  await userEvent.click(screen.getByRole("button", { name: /Layout/ }));
  await userEvent.click(
    await screen.findByRole("option", { name: "Alternative" }),
  );
  await waitFor(() => expect(device.activeLayout).toBe(1));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(device.activeLayout).toBe(0));
});
