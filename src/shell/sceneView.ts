import type { Campaign } from '../game/Campaign.js';
import type { Run } from '../game/Run.js';

export type ShellSceneView =
  | { kind: 'hub'; campaign: Campaign; scene: Campaign }
  | { kind: 'run'; campaign: Campaign; scene: Run };

export function resolveSceneView(campaign: Campaign | null): ShellSceneView | null {
  if (!campaign) return null;
  const activeRun = campaign.activeRun;
  if (!activeRun) {
    return { kind: 'hub', campaign, scene: campaign };
  }
  return { kind: 'run', campaign, scene: activeRun };
}

export function assertRun(view: ShellSceneView): Run {
  if (view.kind !== 'run') {
    throw new Error('[shell] expected an active run scene');
  }
  return view.scene;
}

/** Scene returned by `currentScene()` — hub Campaign or active Run episode. */
export type ShellScene = Campaign | Run;

export function isRun(scene: ShellScene): scene is Run {
  return 'archetype' in scene;
}
