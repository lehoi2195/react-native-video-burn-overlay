import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/** Native-only overlay burning (no third-party libs), avoiding licensing constraints and extra binary size. */
export interface Spec extends TurboModule {
  /**
   * @param videoPath Filesystem path to the source video (no `file://` prefix).
   * @param outputPath Filesystem path to write the burned result to.
   * @param cuesJson JSON-stringified `OverlayCue[]`, passed as a string since codegen supports that type most reliably.
   * @param styleJson JSON-stringified `OverlayStyle` (may be `"{}"`); missing or invalid fields fall back to defaults.
   * @returns The output path of the burned video.
   */
  burnOverlay(
    videoPath: string,
    outputPath: string,
    cuesJson: string,
    styleJson: string
  ): Promise<string>;

  /**
   * Layer-stack burn: draws every layer on the same frame, all at once.
   * @param videoPath Filesystem path to the source video (no `file://` prefix).
   * @param outputPath Filesystem path to write the burned result to.
   * @param layersJson JSON-stringified `OverlayLayer[]`, string for the same codegen reason as cuesJson.
   * @param optionsJson JSON-stringified `{ cropAspectRatio?: number }` (may be `"{}"`).
   * @returns The output path of the burned video.
   */
  burnLayers(
    videoPath: string,
    outputPath: string,
    layersJson: string,
    optionsJson: string
  ): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('VideoOverlay');
