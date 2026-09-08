import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../schema.js';
import { ProjectRepository } from '../repositories/project-repository.js';
import { ProfileRepository } from '../repositories/profile-repository.js';
import { SessionRepository } from '../repositories/session-repository.js';

it('keyset-pages old sessions without duplicates and combines filters after profile deletion', () => {
  const db=new Database(':memory:'); db.pragma('foreign_keys=ON');db.exec(SCHEMA_SQL);
  try {
    const project=new ProjectRepository(db).create({name:'History',rootPath:'/history',tags:[]});
    const profile=new ProfileRepository(db).save({projectId:project.id,name:'Archived profile',failurePolicy:'continue',services:[]});
    const repo=new SessionRepository(db);
    for(let i=0;i<65;i++) {
      const id=crypto.randomUUID();
      repo.save({id,projectId:project.id,runProfileId:profile.id,profileName:profile.name,status:i%2?'STOPPED':'FAILED',
        startedAt:i<60?'2026-09-01T00:00:00.000Z':'2026-09-02T00:00:00.000Z',services:[{
          id:crypto.randomUUID(),runSessionId:id,serviceConfigId:'service',serviceName:i%2?'Web':'API',serviceType:'tool',status:i%2?'STOPPED':'FAILED',
        }]});
    }
    new ProfileRepository(db).remove(profile.id);
    const seen=new Set<string>();let cursor: {id:string;startedAt:string}|undefined;
    do {
      const page=repo.query({projectId:project.id,limit:20,cursor});
      expect(page.sessions.length).toBeLessThanOrEqual(20);
      for(const session of page.sessions) { expect(seen.has(session.id)).toBe(false);seen.add(session.id); }
      cursor=page.nextCursor;
    } while(cursor);
    expect(seen.size).toBe(65);
    const result=repo.query({projectId:project.id,profileName:'archived',serviceName:'api',status:'FAILED',from:'2026-09-02T00:00:00.000Z',to:'2026-09-03T00:00:00.000Z',limit:20});
    expect(result.sessions).toHaveLength(3);
    expect(result.sessions.every(s=>s.services[0].exitCode===undefined && s.stoppedAt===undefined)).toBe(true);
    expect(repo.query({profileName:"' OR 1=1 --",limit:20}).sessions).toHaveLength(0);
    expect(repo.query({projectId:crypto.randomUUID(),limit:20}).sessions).toHaveLength(0);
  } finally {db.close();}
});
