
export enum EntryType {
  BloodSugar = 'blood_sugar',
  Insulin = 'insulin',
  Carbs = 'carbs',
  Activity = 'activity',
  Note = 'note',
}

export enum BloodSugarMeasurementType {
  BeforeMeal = 'Yemek Öncesi',
  AfterMeal = 'Yemek Sonrası',
  Fasting = 'Açlık',
  Bedtime = 'Gece',
  Other = 'Diğer',
  CGM = 'CGM Otomatik',
}

export enum InsulinType {
  Bolus = 'Hızlı Etkili (Bolus)',
  Basal = 'Uzun Etkili (Bazal)',
  Correction = 'Düzeltme',
}

export enum MealType {
  Breakfast = 'Kahvaltı',
  Lunch = 'Öğle Yemeği',
  Dinner = 'Akşam Yemeği',
  Snack = 'Ara Öğün',
}

export interface BaseEntry {
  id: string;
  timestamp: string;
  type: EntryType;
  profileId: string;
}

export interface BloodSugarEntry extends BaseEntry {
  type: EntryType.BloodSugar;
  value: number; // in mg/dL
  measurementType: BloodSugarMeasurementType;
  trendArrow?: number; // 1: Falling Fast, 2: Falling, 3: Stable, 4: Rising, 5: Rising Fast
}

export interface InsulinEntry extends BaseEntry {
  type: EntryType.Insulin;
  units: number;
  insulinType: InsulinType;
}

export interface CarbsEntry extends BaseEntry {
  type: EntryType.Carbs;
  grams: number;
  mealType: MealType;
  description?: string;
  photo?: string; // base64 encoded image
}

export interface ActivityEntry extends BaseEntry {
  type: EntryType.Activity;
  duration: number; // in minutes
  activityType: string;
  intensity: 'low' | 'medium' | 'high';
}

export interface NoteEntry extends BaseEntry {
  type: EntryType.Note;
  text: string;
}

export type LogEntry = BloodSugarEntry | InsulinEntry | CarbsEntry | ActivityEntry | NoteEntry;

/**
 * Represents the data required to add a new log entry, without the `id`, `timestamp`, and `profileId`
 * which are generated automatically. This is a discriminated union to ensure type safety.
 * timestamp is optional to allow manual overrides.
 */
export type AddEntryData = (
  | Omit<BloodSugarEntry, 'id' | 'timestamp' | 'profileId'>
  | Omit<InsulinEntry, 'id' | 'timestamp' | 'profileId'>
  | Omit<CarbsEntry, 'id' | 'timestamp' | 'profileId'>
  | Omit<ActivityEntry, 'id' | 'timestamp' | 'profileId'>
  | Omit<NoteEntry, 'id' | 'timestamp' | 'profileId'>
) & { timestamp?: string };

export type Page = 'dashboard' | 'reports' | 'calculator' | 'settings';

export interface SensorInfo {
  serial: string;
  startDate: string;
  endDate: string;
  daysLeft: number;
  state: string; // 'Aktif', 'Isınıyor', 'Bitti', 'Hata'
}

export interface UserSettings {
  glucoseUnit: 'mg/dL' | 'mmol/L';
  targetRange: {
    low: number;
    high: number;
  };
  insulinToCarbRatio: number; // 1 unit per X grams
  insulinSensitivityFactor: number; // 1 unit lowers BG by X mg/dL
  targetGlucose: number; // Target BG for correction doses
  calculationMethod: 'auto' | 'manual';
  tdd: number; // Total Daily Dose
  notifications: {
    enabled: boolean;
    highLowAlerts: boolean;
  };
  libreLinkUp: {
      status: 'disconnected' | 'connecting' | 'connected' | 'error';
      email: string;
      region: 'EU' | 'US' | 'AE' | 'JP' | 'AP'; 
      lastSync: string | null;
      sensor?: SensorInfo; // Track sensor life
  };
}

export type Gender = 'male' | 'female';

export interface Profile {
  id: string;
  name: string;
  avatar: string; // emoji or character
  settings: UserSettings;
  age?: number;
  gender?: Gender;
  height?: number; // cm
  weight?: number; // kg
  diabetesDuration?: number; // years
}
