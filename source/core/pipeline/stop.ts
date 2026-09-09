/**
 * إشارة تنسيق الإيقاف الآمن (البند 27/28):
 * - تصميم أن ينهي السلسلة المجلد الحالي.
 * - تُفحص بين المجلدات وداخل النقل قبل البدء.
 */

export interface StopSignal {
  stopRequested: () => boolean;
  requestStop: () => void;
  reset: () => void;
}

/** إنشاء إشارة إيقاف جديدة (تقع بين وظيفتين). */
export function createStopSignal(): StopSignal {
  let stopped = false;
  return {
    stopRequested: () => stopped,
    requestStop: () => {
      stopped = true;
    },
    reset: () => {
      stopped = false;
    },
  };
}