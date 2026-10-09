import { z } from 'zod';

export const estimateDaysOptions = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89] as const;
export const hoursPerDay = 8;
export const estimateDaysSchema = z
  .number()
  .int()
  .refine(
    (value) => estimateDaysOptions.some((days) => days === value),
    '请选择斐波那契档位的预估天数',
  );
export const workLogSchema = z.object({
  workDate: z.string().date('请选择有效的工作日期'),
  hours: z.number().int('工时须以 1 小时为单位').min(1).max(24),
  note: z.string().trim().min(1, '请简述完成的工作').max(2000),
});
export interface WorkLog {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string;
  work_date: string;
  hours: number;
  note: string;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface WorkLogPage {
  entries: WorkLog[];
  total: number;
  totalHours: number;
}
export interface WorkReport {
  hoursPerDay: number;
  totalHours: number;
  totalEntries: number;
  byUser: { userId: string; userName: string; hours: number }[];
  byDate: { workDate: string; hours: number }[];
  byTask: {
    taskId: string;
    title: string;
    boardKey: string;
    seq: number;
    workspaceKey: string;
    estimateDays: number | null;
    hours: number;
    totalTaskHours: number;
  }[];
}
