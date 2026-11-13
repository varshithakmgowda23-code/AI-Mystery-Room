import type { PlayerCaseView } from '@ai-mystery-room/shared';

/** Accusation controls for the case board. Filled in by the accusation flow (Phase D). */
export function useCaseActions(data: PlayerCaseView | undefined) {
  const resolved = data?.status === 'resolved';
  function AccuseButton() {
    return (
      <button type="button" className="primary-button" disabled={!data || resolved} title="Coming next">
        Make accusation
      </button>
    );
  }
  return { AccuseButton, accuseDialog: null };
}
