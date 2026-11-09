/** Matches the host's compact settings surfaces; controls are the SDK's actual UI. */
export const styles = `
.hermes-projects { box-sizing: border-box; height: 100%; min-width: 0; font-size: 12px; line-height: 1.5; color: var(--ui-text-primary); background: var(--ui-bg-editor); }
.hermes-projects h1 { font-size: 18px; line-height: 24px; font-weight: 600; margin: 0; margin-right: auto; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.hermes-projects h2 { font-size: 13px; font-weight: 600; margin: 16px 0 0; }
.hermes-projects p { margin: 0; color: var(--ui-text-secondary); overflow-wrap: anywhere; }
.hermes-projects [role=alert] { color: var(--ui-text-primary); border-left: 2px solid var(--ui-text-tertiary); padding-left: 12px; }
.hermes-projects header { padding-bottom: 16px; border-bottom: 1px solid var(--ui-stroke-secondary); }
.hermes-projects header span, .hermes-projects small { color: var(--ui-text-tertiary); font-size: 11px; }
.hermes-projects label { display: flex; flex-direction: column; gap: 6px; color: var(--ui-text-secondary); }
.hermes-projects form { max-width: 640px; }
.hermes-projects form > button { margin-top: 12px; }
.hermes-projects ul { padding: 0; list-style: none; margin: 0; }
.hermes-projects li { padding: 10px 0; border-bottom: 1px solid var(--ui-stroke-secondary); overflow-wrap: anywhere; }
.hermes-projects article { min-width: 0; }
.hermes-projects button { max-width: 100%; min-width: 0; white-space: normal; height: auto; min-height: 28px; overflow-wrap: anywhere; }
.hermes-projects article button { text-align: left; }
.hermes-projects header span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 600px) {
.hermes-projects header h1 { width: 100%; }
.hermes-projects button { white-space: normal; min-height: 32px; }
.hermes-projects article button { text-align: left; max-width: 100%; overflow-wrap: anywhere; }
.hermes-projects form, .hermes-projects label { width: 100%; min-width: 0; }
}
`;
