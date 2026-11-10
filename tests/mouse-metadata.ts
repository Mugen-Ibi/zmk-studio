import { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

// ZMK PR #2950: button masks, not consecutive button numbers.
export const mouse = GetBehaviorDetailsResponse.fromPartial({
  id: 42,
  displayName: "Mouse Key Press",
  metadata: [
    {
      param1: [1, 2, 4, 8, 16].map((constant, i) => ({
        name: `MB${i + 1}`,
        constant,
      })),
      param2: [],
    },
  ],
});

export const keyPress = GetBehaviorDetailsResponse.fromPartial({
  id: 7,
  displayName: "Key Press",
  metadata: [
    {
      param1: [
        { name: "Key", hidUsage: { keyboardMax: 255, consumerMax: 4095 } },
      ],
      param2: [],
    },
  ],
});

export const layer = GetBehaviorDetailsResponse.fromPartial({
  id: 9,
  displayName: "Momentary Layer",
  metadata: [{ param1: [{ name: "Layer", layerId: {} }], param2: [] }],
});
