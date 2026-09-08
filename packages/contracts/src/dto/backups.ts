import { z } from 'zod';
export const BackupPolicySchema=z.object({
  maxBackups:z.number().int().min(3).max(200).default(20),
  maxTotalMb:z.number().int().min(64).max(20480).default(2048),
});
export type BackupPolicyDto=z.infer<typeof BackupPolicySchema>;
export interface BackupSummaryDto {
  id:string;createdAt:string;bytes:number;appVersion:string;schemaVersion:number;
  reason:string;pinned:boolean;status:'verified'|'unavailable';error?:string;
}
export interface RestorePreviewDto {
  token:string;backupId:string;createdAt:string;schemaVersion:number;targetSchemaVersion:number;
  counts:Record<string,number>;unreadableSecrets:number;
}
export interface BackupStatusDto { entries:BackupSummaryDto[];policy:BackupPolicyDto;directory:string;notice?:string }
