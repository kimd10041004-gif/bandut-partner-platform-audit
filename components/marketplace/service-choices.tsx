'use client';
import { motion,useReducedMotion } from 'framer-motion';
import { Checkbox } from '@/components/ui/checkbox';
import { categories } from '@/lib/policy';
import { Droplets,DoorOpen,Lightbulb,Grid2X2,PanelTop,Drill,HelpCircle,Wind,Wifi,Plug,PaintRoller,Armchair,PanelsTopLeft,Bath,Building2,Hammer,Sparkles } from 'lucide-react';
const icons:Record<string,typeof Droplets>={PLUMBING:Droplets,LOCK:DoorOpen,ELECTRIC:Lightbulb,SCREEN:Grid2X2,CURTAIN:PanelTop,FIXTURE:Drill,HVAC:Wind,SMART_HOME:Wifi,APPLIANCE:Plug,WALL_FINISH:PaintRoller,FLOOR:Grid2X2,CARPENTRY:Armchair,WINDOW:PanelsTopLeft,KITCHEN_BATH:Bath,WATERPROOF:Droplets,RENOVATION:Hammer,COMMERCIAL:Building2,RESTORATION:Hammer,MAINTENANCE:Sparkles,UNKNOWN:HelpCircle};
export function ServiceChoices({available,items,toggle}:{available:(typeof categories)[number][];items:string[];toggle:(code:string)=>void}){const reduce=useReducedMotion();return <div className="category-grid">{available.map(([code,label,desc])=>{const Icon=icons[code]??HelpCircle;return <motion.label key={code} whileHover={reduce?undefined:{y:-3}} whileTap={reduce?undefined:{scale:.98}} className={'category '+(items.includes(code)?'selected':'')}><Checkbox aria-label={label} checked={items.includes(code)} onCheckedChange={()=>toggle(code)}/><Icon size={28} strokeWidth={1.5}/><strong>{label}</strong><small>{desc}</small></motion.label>})}</div>;}
