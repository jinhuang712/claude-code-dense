/** What a folded transcript row draws once its turn has ended. */
export type FoldRow =
  | { role: 'summary'; turnId: string; text: string; failed: number }
  | { role: 'hidden'; turnId: string }

declare module 'claude-code' {
  interface PluginState {
    dense: {
      /** Per row, by rowKey of its tool_use_id or message id. */
      row: StateFamily<FoldRow | null>
      /** Per turn id: unfolded by its expand button. */
      expanded: StateFamily<boolean>
    }
  }
}
