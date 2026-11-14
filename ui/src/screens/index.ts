// Auto-generated registry of all 52 Figma screens ("NASA Space App" · ver.1).
import { META as HealthHomeMeta, renderHealthHome } from "./HealthHome";
import { META as HealthEnvironmentMeta, renderHealthEnvironment } from "./HealthEnvironment";
import { META as HealthEnvironmentRadiationMeta, renderHealthEnvironmentRadiation } from "./HealthEnvironmentRadiation";
import { META as HealthEnvironmentGravityMeta, renderHealthEnvironmentGravity } from "./HealthEnvironmentGravity";
import { META as HealthVitalsMeta, renderHealthVitals } from "./HealthVitals";
import { META as HealthNutritionMeta, renderHealthNutrition } from "./HealthNutrition";
import { META as HealthSleepMeta, renderHealthSleep } from "./HealthSleep";
import { META as HealthMindfulnessMeta, renderHealthMindfulness } from "./HealthMindfulness";
import { META as HealthRiskDetailImmuneMeta, renderHealthRiskDetailImmune } from "./HealthRiskDetailImmune";
import { META as HealthRiskDetailBoneMuscleMeta, renderHealthRiskDetailBoneMuscle } from "./HealthRiskDetailBoneMuscle";
import { META as HealthRiskDetailHeartMeta, renderHealthRiskDetailHeart } from "./HealthRiskDetailHeart";
import { META as LogEnvironmentMeta, renderLogEnvironment } from "./LogEnvironment";
import { META as LogEnvironmentRadiationMeta, renderLogEnvironmentRadiation } from "./LogEnvironmentRadiation";
import { META as LogEnvironmentGravityMeta, renderLogEnvironmentGravity } from "./LogEnvironmentGravity";
import { META as LogVitalsMeta, renderLogVitals } from "./LogVitals";
import { META as LogNutritionMeta, renderLogNutrition } from "./LogNutrition";
import { META as LogSleepMeta, renderLogSleep } from "./LogSleep";
import { META as LogMindfulnessMeta, renderLogMindfulness } from "./LogMindfulness";
import { META as LogVitalsGuideBloodPressureMeta, renderLogVitalsGuideBloodPressure } from "./LogVitalsGuideBloodPressure";
import { META as LogVitalsGuideWearableFitCheckMeta, renderLogVitalsGuideWearableFitCheck } from "./LogVitalsGuideWearableFitCheck";
import { META as HealthRiskDetailImmuneGuideSalivaSampleMeta, renderHealthRiskDetailImmuneGuideSalivaSample } from "./HealthRiskDetailImmuneGuideSalivaSample";
import { META as EmergencyHubMeta, renderEmergencyHub } from "./EmergencyHub";
import { META as EmergencySolarRadiationStormMeta, renderEmergencySolarRadiationStorm } from "./EmergencySolarRadiationStorm";
import { META as EmergencyFaintingMeta, renderEmergencyFainting } from "./EmergencyFainting";
import { META as SettingsProfileMeta, renderSettingsProfile } from "./SettingsProfile";
import { META as DetailHealthScoreMeta, renderDetailHealthScore } from "./DetailHealthScore";
import { META as DetailRestingHeartRateMeta, renderDetailRestingHeartRate } from "./DetailRestingHeartRate";
import { META as DetailHrvMeta, renderDetailHrv } from "./DetailHrv";
import { META as DetailBloodPressureMeta, renderDetailBloodPressure } from "./DetailBloodPressure";
import { META as DetailBloodOxygenSpo2Meta, renderDetailBloodOxygenSpo2 } from "./DetailBloodOxygenSpo2";
import { META as DetailSleepDurationMeta, renderDetailSleepDuration } from "./DetailSleepDuration";
import { META as DetailSleepScoreMeta, renderDetailSleepScore } from "./DetailSleepScore";
import { META as DetailSleepQualityMeta, renderDetailSleepQuality } from "./DetailSleepQuality";
import { META as DetailSleepAidUseMeta, renderDetailSleepAidUse } from "./DetailSleepAidUse";
import { META as DetailStressScoreMeta, renderDetailStressScore } from "./DetailStressScore";
import { META as DetailMoodMeta, renderDetailMood } from "./DetailMood";
import { META as DetailMindfulPracticeMeta, renderDetailMindfulPractice } from "./DetailMindfulPractice";
import { META as DetailMissionDayMeta, renderDetailMissionDay } from "./DetailMissionDay";
import { META as DetailCaloriesProteinMeta, renderDetailCaloriesProtein } from "./DetailCaloriesProtein";
import { META as DetailWaterMeta, renderDetailWater } from "./DetailWater";
import { META as DetailVitaminDMeta, renderDetailVitaminD } from "./DetailVitaminD";
import { META as DetailGlucoseMeta, renderDetailGlucose } from "./DetailGlucose";
import { META as DetailBodyMassMeta, renderDetailBodyMass } from "./DetailBodyMass";
import { META as DetailSodiumMeta, renderDetailSodium } from "./DetailSodium";
import { META as DetailCabinAirCo2Meta, renderDetailCabinAirCo2 } from "./DetailCabinAirCo2";
import { META as DetailRadiationDoseMeta, renderDetailRadiationDose } from "./DetailRadiationDose";
import { META as DetailMissionCareerDoseMeta, renderDetailMissionCareerDose } from "./DetailMissionCareerDose";
import { META as DetailSpaceWeatherMeta, renderDetailSpaceWeather } from "./DetailSpaceWeather";
import { META as DetailMicrogravityExposureMeta, renderDetailMicrogravityExposure } from "./DetailMicrogravityExposure";
import { META as DetailBoneDensityMeta, renderDetailBoneDensity } from "./DetailBoneDensity";
import { META as DetailExerciseCountermeasuresMeta, renderDetailExerciseCountermeasures } from "./DetailExerciseCountermeasures";
import { META as DetailFluidShiftCountermeasureMeta, renderDetailFluidShiftCountermeasure } from "./DetailFluidShiftCountermeasure";

export type ScreenId =
  "HealthHome" |
  "HealthEnvironment" |
  "HealthEnvironmentRadiation" |
  "HealthEnvironmentGravity" |
  "HealthVitals" |
  "HealthNutrition" |
  "HealthSleep" |
  "HealthMindfulness" |
  "HealthRiskDetailImmune" |
  "HealthRiskDetailBoneMuscle" |
  "HealthRiskDetailHeart" |
  "LogEnvironment" |
  "LogEnvironmentRadiation" |
  "LogEnvironmentGravity" |
  "LogVitals" |
  "LogNutrition" |
  "LogSleep" |
  "LogMindfulness" |
  "LogVitalsGuideBloodPressure" |
  "LogVitalsGuideWearableFitCheck" |
  "HealthRiskDetailImmuneGuideSalivaSample" |
  "EmergencyHub" |
  "EmergencySolarRadiationStorm" |
  "EmergencyFainting" |
  "SettingsProfile" |
  "DetailHealthScore" |
  "DetailRestingHeartRate" |
  "DetailHrv" |
  "DetailBloodPressure" |
  "DetailBloodOxygenSpo2" |
  "DetailSleepDuration" |
  "DetailSleepScore" |
  "DetailSleepQuality" |
  "DetailSleepAidUse" |
  "DetailStressScore" |
  "DetailMood" |
  "DetailMindfulPractice" |
  "DetailMissionDay" |
  "DetailCaloriesProtein" |
  "DetailWater" |
  "DetailVitaminD" |
  "DetailGlucose" |
  "DetailBodyMass" |
  "DetailSodium" |
  "DetailCabinAirCo2" |
  "DetailRadiationDose" |
  "DetailMissionCareerDose" |
  "DetailSpaceWeather" |
  "DetailMicrogravityExposure" |
  "DetailBoneDensity" |
  "DetailExerciseCountermeasures" |
  "DetailFluidShiftCountermeasure";

export interface ScreenEntry {
  readonly id: ScreenId;
  readonly name: string;
  readonly nodeId: string;
  readonly category: string;
  readonly render: () => HTMLElement;
}

export const SCREENS: readonly ScreenEntry[] = [
  { ...HealthHomeMeta, render: renderHealthHome },
  { ...HealthEnvironmentMeta, render: renderHealthEnvironment },
  { ...HealthEnvironmentRadiationMeta, render: renderHealthEnvironmentRadiation },
  { ...HealthEnvironmentGravityMeta, render: renderHealthEnvironmentGravity },
  { ...HealthVitalsMeta, render: renderHealthVitals },
  { ...HealthNutritionMeta, render: renderHealthNutrition },
  { ...HealthSleepMeta, render: renderHealthSleep },
  { ...HealthMindfulnessMeta, render: renderHealthMindfulness },
  { ...HealthRiskDetailImmuneMeta, render: renderHealthRiskDetailImmune },
  { ...HealthRiskDetailBoneMuscleMeta, render: renderHealthRiskDetailBoneMuscle },
  { ...HealthRiskDetailHeartMeta, render: renderHealthRiskDetailHeart },
  { ...LogEnvironmentMeta, render: renderLogEnvironment },
  { ...LogEnvironmentRadiationMeta, render: renderLogEnvironmentRadiation },
  { ...LogEnvironmentGravityMeta, render: renderLogEnvironmentGravity },
  { ...LogVitalsMeta, render: renderLogVitals },
  { ...LogNutritionMeta, render: renderLogNutrition },
  { ...LogSleepMeta, render: renderLogSleep },
  { ...LogMindfulnessMeta, render: renderLogMindfulness },
  { ...LogVitalsGuideBloodPressureMeta, render: renderLogVitalsGuideBloodPressure },
  { ...LogVitalsGuideWearableFitCheckMeta, render: renderLogVitalsGuideWearableFitCheck },
  { ...HealthRiskDetailImmuneGuideSalivaSampleMeta, render: renderHealthRiskDetailImmuneGuideSalivaSample },
  { ...EmergencyHubMeta, render: renderEmergencyHub },
  { ...EmergencySolarRadiationStormMeta, render: renderEmergencySolarRadiationStorm },
  { ...EmergencyFaintingMeta, render: renderEmergencyFainting },
  { ...SettingsProfileMeta, render: renderSettingsProfile },
  { ...DetailHealthScoreMeta, render: renderDetailHealthScore },
  { ...DetailRestingHeartRateMeta, render: renderDetailRestingHeartRate },
  { ...DetailHrvMeta, render: renderDetailHrv },
  { ...DetailBloodPressureMeta, render: renderDetailBloodPressure },
  { ...DetailBloodOxygenSpo2Meta, render: renderDetailBloodOxygenSpo2 },
  { ...DetailSleepDurationMeta, render: renderDetailSleepDuration },
  { ...DetailSleepScoreMeta, render: renderDetailSleepScore },
  { ...DetailSleepQualityMeta, render: renderDetailSleepQuality },
  { ...DetailSleepAidUseMeta, render: renderDetailSleepAidUse },
  { ...DetailStressScoreMeta, render: renderDetailStressScore },
  { ...DetailMoodMeta, render: renderDetailMood },
  { ...DetailMindfulPracticeMeta, render: renderDetailMindfulPractice },
  { ...DetailMissionDayMeta, render: renderDetailMissionDay },
  { ...DetailCaloriesProteinMeta, render: renderDetailCaloriesProtein },
  { ...DetailWaterMeta, render: renderDetailWater },
  { ...DetailVitaminDMeta, render: renderDetailVitaminD },
  { ...DetailGlucoseMeta, render: renderDetailGlucose },
  { ...DetailBodyMassMeta, render: renderDetailBodyMass },
  { ...DetailSodiumMeta, render: renderDetailSodium },
  { ...DetailCabinAirCo2Meta, render: renderDetailCabinAirCo2 },
  { ...DetailRadiationDoseMeta, render: renderDetailRadiationDose },
  { ...DetailMissionCareerDoseMeta, render: renderDetailMissionCareerDose },
  { ...DetailSpaceWeatherMeta, render: renderDetailSpaceWeather },
  { ...DetailMicrogravityExposureMeta, render: renderDetailMicrogravityExposure },
  { ...DetailBoneDensityMeta, render: renderDetailBoneDensity },
  { ...DetailExerciseCountermeasuresMeta, render: renderDetailExerciseCountermeasures },
  { ...DetailFluidShiftCountermeasureMeta, render: renderDetailFluidShiftCountermeasure }
];

export const SCREEN_MAP: Record<ScreenId, ScreenEntry> = Object.fromEntries(
  SCREENS.map((s) => [s.id, s]),
) as Record<ScreenId, ScreenEntry>;
