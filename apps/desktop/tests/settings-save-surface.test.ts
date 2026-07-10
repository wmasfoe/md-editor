import { describe, expect, it, vi } from "vitest";
import { closeSettingsSurfaceAfterSave } from "../src/app/controller/useSettingsController";

describe("settings save surface close behavior", () => {
  it("closes the embedded settings page after saving in the main surface", async () => {
    const closeEmbeddedSettings = vi.fn();
    const closeSettingsWindow = vi.fn(async () => true);
    const showSavedToast = vi.fn();

    await closeSettingsSurfaceAfterSave({
      surface: "main",
      closeEmbeddedSettings,
      closeSettingsWindow,
      showSavedToast,
    });

    expect(closeEmbeddedSettings).toHaveBeenCalledOnce();
    expect(closeSettingsWindow).not.toHaveBeenCalled();
    expect(showSavedToast).not.toHaveBeenCalled();
  });

  it("closes the standalone settings window after saving", async () => {
    const closeEmbeddedSettings = vi.fn();
    const closeSettingsWindow = vi.fn(async () => true);
    const showSavedToast = vi.fn();

    await closeSettingsSurfaceAfterSave({
      surface: "settings-window",
      closeEmbeddedSettings,
      closeSettingsWindow,
      showSavedToast,
    });

    expect(closeEmbeddedSettings).not.toHaveBeenCalled();
    expect(closeSettingsWindow).toHaveBeenCalledOnce();
    expect(showSavedToast).not.toHaveBeenCalled();
  });

  it("keeps a saved confirmation for non-native settings previews that cannot close a window", async () => {
    const closeEmbeddedSettings = vi.fn();
    const closeSettingsWindow = vi.fn(async () => false);
    const showSavedToast = vi.fn();

    await closeSettingsSurfaceAfterSave({
      surface: "settings-window",
      closeEmbeddedSettings,
      closeSettingsWindow,
      showSavedToast,
    });

    expect(closeEmbeddedSettings).not.toHaveBeenCalled();
    expect(closeSettingsWindow).toHaveBeenCalledOnce();
    expect(showSavedToast).toHaveBeenCalledOnce();
  });
});
