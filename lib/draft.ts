import {z} from 'zod';
import {workCodes,districts} from './policy';
export const draftInput=z.object({step:z.number().int().min(0).max(3),items:z.array(z.string().refine(v=>workCodes.includes(v as typeof workCodes[number]))).max(workCodes.length),locked:z.boolean().nullable(),urgent:z.boolean().nullable(),ack:z.boolean(),description:z.string().max(2000),city:z.string().refine(v=>Object.hasOwn(districts,v),'지원하는 시·도를 선택해 주세요.'),district:z.string().max(20),address:z.string().max(200),phone:z.string().max(14),date:z.string().max(10),budget:z.string().max(12)}).strict().refine(v=>!v.district||districts[v.city]?.includes(v.district),'선택한 지역을 확인해 주세요.');
export type DraftInput=z.infer<typeof draftInput>;
export interface SavedDraft{id:string;revision:number;data:DraftInput;updatedAt:string;expiresAt:string}
