import { registerPlugin, Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

window.JerryLocalMusic = registerPlugin("LocalMusic");
window.JerryCapacitor = Capacitor;
window.JerryHaptics = {
  tap: () => Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}),
  success: () => Haptics.notification({ type: NotificationType.Success }).catch(() => {})
};
