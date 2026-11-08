import { describe, expect, it } from "vitest";

import {
  DEFAULT_AI_SETTINGS,
  LITE_LOCAL_MODEL_ID,
  STANDARD_LOCAL_MODEL_ID,
  type AiSettings,
} from "../../src/index.ts";
import {
  DEFAULT_STYLE_LEARNING_SETTINGS,
  evaluateStyleGate,
  gateStyleProfile,
  mergeStyleProfile,
  normalizeStyleLearningSettings,
  styleCloudScope,
  type StyleLearningSettings,
} from "../../src/style/index.ts";
import { activeRule } from "./fixtures.ts";

const profile = mergeStyleProfile({ workspace: [activeRule("termScript", "keep-english")] });
const enabled: StyleLearningSettings = { ...DEFAULT_STYLE_LEARNING_SETTINGS, enabled: true };

function local(modelId: string): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    provider: "local",
    localModel: { ...DEFAULT_AI_SETTINGS.localModel, modelId },
  };
}

const cloud: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  provider: "openai",
  endpoints: {
    ...DEFAULT_AI_SETTINGS.endpoints,
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "k" },
  },
};

describe("style profile gate", () => {
  it("U-GT-1: disabled style learning never attaches a profile", () => {
    expect(
      evaluateStyleGate(local(STANDARD_LOCAL_MODEL_ID), DEFAULT_STYLE_LEARNING_SETTINGS, profile),
    ).toEqual({
      allowed: false,
      reason: "disabled",
    });
    expect(evaluateStyleGate(local(STANDARD_LOCAL_MODEL_ID), enabled, { rules: [] })).toMatchObject(
      {
        reason: "empty",
      },
    );
  });

  it("U-GT-2: Lite never uses the profile; Standard does", () => {
    expect(gateStyleProfile(local(LITE_LOCAL_MODEL_ID), enabled, profile)).toBeUndefined();
    expect(evaluateStyleGate(local(LITE_LOCAL_MODEL_ID), enabled, profile)).toMatchObject({
      reason: "lite-model",
    });
    expect(gateStyleProfile(local(STANDARD_LOCAL_MODEL_ID), enabled, profile)).toBe(profile);
  });

  it("U-GT-3: cloud requires consent bound to provider and origin; revoking removes it", () => {
    expect(evaluateStyleGate(cloud, enabled, profile)).toMatchObject({
      reason: "cloud-consent-required",
    });
    const scope = styleCloudScope(cloud);
    expect(scope).toEqual({ provider: "openai", origin: "https://api.openai.com" });
    const consented = { ...enabled, cloudConsent: { ...scope, grantedAt: "2026-11-09T00:00:00Z" } };
    expect(gateStyleProfile(cloud, consented, profile)).toBe(profile);

    const otherEndpoint: AiSettings = {
      ...cloud,
      endpoints: {
        ...cloud.endpoints,
        openai: { ...cloud.endpoints.openai, baseUrl: "https://api.deepseek.com" },
      },
    };
    expect(gateStyleProfile(otherEndpoint, consented, profile)).toBeUndefined();
    expect(
      gateStyleProfile({ ...cloud, provider: "anthropic" }, consented, profile),
    ).toBeUndefined();
    expect(gateStyleProfile(cloud, { ...consented, cloudConsent: null }, profile)).toBeUndefined();
  });

  it("U-SET-1: normalizes missing or malformed settings to off", () => {
    expect(normalizeStyleLearningSettings(undefined)).toEqual(DEFAULT_STYLE_LEARNING_SETTINGS);
    expect(
      normalizeStyleLearningSettings({
        enabled: "yes",
        autoRelink: 1,
        cloudConsent: { provider: "openai" },
      }),
    ).toEqual(DEFAULT_STYLE_LEARNING_SETTINGS);
    expect(
      normalizeStyleLearningSettings({
        enabled: true,
        autoRelink: true,
        cloudConsent: { provider: "openai", origin: "https://api.openai.com", grantedAt: "t" },
      }),
    ).toEqual({
      enabled: true,
      autoRelink: true,
      cloudConsent: { provider: "openai", origin: "https://api.openai.com", grantedAt: "t" },
    });
  });
});
