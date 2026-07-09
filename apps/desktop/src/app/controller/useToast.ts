import { useToastStore } from "../stores/toast-store";

export function useToast() {
  const toast = useToastStore((state) => state.toast);
  const showToast = useToastStore((state) => state.showToast);

  return { toast, showToast };
}
