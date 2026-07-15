import type { Campaign } from '../game/Campaign.js';
import type { Crew } from '../game/Crew.js';
import type { CampaignChronicleEntry } from '../game/chronicle.js';
import type { Contract } from '../game/hub/Curator.js';
import type { Item } from '../game/items.js';
import type { CampaignSummary } from '../game/campaignSummary.js';
import type { TypedSalvage } from '../game/salvage.js';
import type { KeyItem, Telemetry } from '../types.js';
import type { AimKind, Mode, PerkAim } from '../input/keymap.js';
import type {
  UpdateAvailableDetail,
  UpdateRestartRequiredDetail,
} from '../ServiceWorkerManager.js';

export type HelpScope = 'hub' | 'combat';

/**
 * A key item enriched for display with its resolved location name
 * (`${principal} ${site}`). The name is derived from the campaign roster at
 * render time — not persisted on the `KeyItem` — and is absent for legacy
 * untokenized sites.
 */
export type KeyItemView = KeyItem & { locationName?: string };

export type ModalElement = HTMLElement & {
  show(): void;
  hide(): void;
  readonly isOpen: boolean;
};

export type CuratorBriefingContent = { title: string; lines: readonly string[] };

export type RunBriefingElement = ModalElement & {
  setContract(contract: Contract): void;
  setCrew(crew: Crew[]): void;
};

export type ContractSelectElement = ModalElement & {
  setContracts(contracts: Contract[]): void;
  setScoreTargetSiteId(siteId: string | null): void;
  setScorePrincipalId(principalId: string | null): void;
  setHeldKeycardPrincipalIds(principalIds: string[]): void;
};

export type CrashDumpElement = ModalElement & {
  setTelemetry(telemetry: Telemetry): void;
};

export type GameOverElement = ModalElement & {
  setSummary(summary: CampaignSummary): void;
};

export type FaultScreenElement = ModalElement & {
  show(detail: { code?: string }): void;
};

export type SystemStartElement = ModalElement & {
  setSession(session: { seed: number }): void;
};

export type CuratorBriefingElement = ModalElement & {
  setBriefing(content: CuratorBriefingContent): void;
};

export type InitialRecruitElement = ModalElement & {
  setCandidates(candidates: Crew[]): void;
};

export type CrewRosterElement = ModalElement & {
  setCrew(
    crew: Crew[],
    opts?: {
      salvage?: TypedSalvage;
      campaignStatus?: string | readonly string[];
      availableRecruits?: Crew[];
      recruitedThisVisit?: boolean;
    }
  ): void;
};

export type ChronicleArchiveElement = ModalElement & {
  setData(data: {
    activeChronicle?: {
      statusLines?: readonly string[];
      entries: readonly CampaignChronicleEntry[];
    } | null;
    history: readonly CampaignSummary[];
    acquisitions: { unlocked: number; total: number };
  }): void;
};

export type FinnShopElement = ModalElement & {
  setCatalog(
    catalog: Item[],
    crew: Crew[],
    balances: { credits: number; salvage: TypedSalvage }
  ): void;
};

export type ClinicModalElement = ModalElement & {
  setPatients(crew: Crew[], balances: { credits: number; healedMemberIds?: string[] }): void;
};

/** `<combat-inventory>` — the deployed operator's interactive kit. */
export type CombatInventoryElement = ModalElement & {
  setContents(contents: {
    salvage?: TypedSalvage;
    consumables?: NonNullable<Crew['inventory']>['consumables'];
    keyItems?: KeyItemView[];
  }): void;
};

/** `<crew-inventory>` — the Hub's read-only campaign stash. */
export type CrewInventoryElement = ModalElement & {
  setContents(contents: { salvage?: TypedSalvage; keyItems?: KeyItemView[] }): void;
};

export type KeyHelpElement = ModalElement & {
  setScope(scope: HelpScope, archetypeId?: string): void;
};

export type TouchPadElement = HTMLElement & {
  mode: Mode;
  aimKind: AimKind | null;
  setMode(mode: Mode, aimKind?: AimKind | null): void;
  setBlocked(predicate: (() => boolean) | null): void;
  setSpecialAim(resolver: (() => PerkAim) | null): void;
  setFlipAvailable(available: boolean): void;
};

export type ConfirmationModalElement = HTMLElement & {
  showModal(message: string, context?: unknown): void;
};

export type UpdateNotificationElement = HTMLElement & {
  show(update: UpdateAvailableDetail): void;
  showRestartRequired(release: UpdateRestartRequiredDetail['release']): void;
  showUnavailable(message: string): void;
  showUpdating(status?: string): void;
  showFailure(message: string): void;
  readonly isOpen: boolean;
};

export type InputState = {
  mode: Mode;
  aimKind: AimKind | null;
};

export type EntityDamagedPayload = {
  attacker?: import('../game/Entity.js').Entity;
  target?: import('../game/Entity.js').Entity;
  damage?: number;
  killed?: boolean;
  source?: string;
  damageResolution?: import('../types.js').DamageResolution;
};

export type NoisePayload = {
  kind?: string;
  origin?: { x: number; y: number };
};

export type DoorUnlockPayload = {
  label?: string;
};

export type MindInfluencedPayload = {
  actor?: import('../game/Entity.js').Entity;
  target?: import('../game/Entity.js').Entity;
  success?: boolean;
};

export type RazorCloakedPayload = {
  actor?: import('../game/Entity.js').Entity;
};

export type ShellDomRefs = {
  stageEl: HTMLElement;
  pipCanvas: HTMLCanvasElement;
};

export type ShellRenderers = {
  main: import('../render/AsciiRenderer.js').AsciiRenderer;
  pip: import('../render/AsciiRenderer.js').AsciiRenderer;
};

export type AnimationLock = {
  push(ms: number): void;
};

export type SceneListenerDeps = {
  getScene: () => import('./sceneView.js').ShellScene | null;
  getCampaign: () => Campaign | null;
  getMeatVision: () => import('../game/Vision.js').VisionField;
  getCyberVision: () => import('../game/Vision.js').VisionField;
  resetCyberVision: () => import('../game/Vision.js').VisionField;
  dom: ShellDomRefs;
  renderers: ShellRenderers;
  animLock: AnimationLock;
  effects: {
    flash(line: string): void;
    paint(): void;
    paintPip(): void;
    recomputeVision(): void;
  };
  onCivilianHarmReset(): void;
  onCivilianHarmed(killed: boolean): void;
  onRepAdjust(actual: number, reason: string): void;
  onAlarmTransition(transition: string): void;
  onObjectiveTimerExpired(title: string): void;
  memoriseMeatCorpse(
    target: import('../game/Entity.js').Entity,
    isVisible: (x: number, y: number) => boolean
  ): void;
  memoriseCyberCorpse(
    target: import('../game/Entity.js').Entity,
    isVisible: (x: number, y: number) => boolean
  ): void;
};
