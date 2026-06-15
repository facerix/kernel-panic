import { CAMPAIGN_STATE } from '../game/Campaign.js';
import type { Campaign } from '../game/Campaign.js';
import { formatHubArcStatusLines } from '../game/hub/arcSurface.js';
import { isCyberView } from './activeView.js';
import type { ShellScene } from './sceneView.js';

/**
 * The persistent location chip text for the canvas top-left. Combat shows
 * the contract's site flavor label (bracketed by `//`); the Hub shows
 * "// Safe House //" so the corner always answers "where am I".
 */
export function currentLocationLabel(
  campaign: Campaign | null,
  scene: ShellScene | null
): string | undefined {
  if (!campaign) return undefined;
  if (isCyberView(scene)) {
    return '// THE GRID //';
  }
  if (campaign.state === CAMPAIGN_STATE.COMBAT && campaign.activeRun?.contract) {
    const { principal, site } = campaign.activeRun.contract.context;
    const siteName = site?.label ?? 'Location Unknown';
    const labelName = `${principal.label} - ${siteName}`;
    return `// ${labelName} //`;
  }
  if (campaign.state === CAMPAIGN_STATE.HUB) {
    return '// Safe House //';
  }
  return undefined;
}

export function buildHubHudRows(campaign: Campaign | null, scene: ShellScene | null) {
  if (!campaign || scene?.state !== CAMPAIGN_STATE.HUB) return undefined;
  const [summary, clock] = formatHubArcStatusLines(campaign);
  const rows = [
    {
      text: summary,
      anchor: 'top-left' as const,
      row: 1,
      color: '#ffd166',
      glowColor: '#ffd166',
      accentColor: 'rgba(255, 209, 102, 0.5)',
      uppercase: true,
    },
  ];
  if (clock) {
    rows.push({
      text: clock,
      anchor: 'top-left' as const,
      row: 2,
      color: '#ffd166',
      glowColor: '#ffd166',
      accentColor: 'rgba(255, 209, 102, 0.5)',
      uppercase: true,
    });
  }
  return rows;
}
