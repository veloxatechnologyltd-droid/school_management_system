import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module';
import { ApiErrors } from './core/errors';
import { randomUUID } from 'node:crypto';
import { Database } from './core/database';
import { serverConfig } from './core/config';
import { assertMigrated, readiness } from './core/health';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface AppOptions { env?: NodeJS.ProcessEnv; log?: (line: string) => void }
export async function createApp({env = process.env, log = (line: string) => console.log(line)}: AppOptions = {}) {
  const config = serverConfig(env);
  const app = await NestFactory.create(AppModule,{logger:['error','warn']});
  app.getHttpAdapter().getInstance().set('trust proxy',config.trustProxy);
  app.use(helmet());
  const attempts = new Map<string,{count:number;until:number}>();
  const signups = new Map<string,{count:number;until:number}>();
  app.use((req:Request,res:Response,next:NextFunction) => {
    const requestId = randomUUID(), started = process.hrtime.bigint();
    res.setHeader('x-request-id',requestId);
    // Route pattern and school ID only: never the query string, body or path values that can identify a child.
    res.on('finish',() => log(JSON.stringify({time:new Date().toISOString(),requestId,method:req.method,route:req.route?.path ?? 'unmatched',status:res.statusCode,durationMs:Math.round(Number(process.hrtime.bigint()-started)/1e4)/100,schoolId:typeof req.params?.schoolId === 'string' && uuid.test(req.params.schoolId) ? req.params.schoolId : undefined})));
    next();
  });
  const database = app.get(Database);
  app.use('/healthz',(_req:Request,res:Response) => res.json({status:'ok'}));
  app.use('/readyz',async (_req:Request,res:Response) => {
    const result = await readiness(database.pool,env.MIGRATIONS_DIR || undefined);
    res.status(result.ready ? 200 : 503).json({status:result.ready ? 'ready' : 'not_ready',checks:result.checks});
  });
  app.use((req:Request,res:Response,next:NextFunction) => {
    if (!config.hostAllowed(req.headers.host)) return res.status(403).json({message:'Host not allowed'});
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && !config.originAllowed(req.headers.origin,req.headers.host)) return res.status(403).json({message:'Request origin was not accepted'});
    if (req.path === '/api/v1/auth/login' && req.method === 'POST') {
      const address=req.ip??'unknown';const now=Date.now();
      for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
      const current=attempts.get(address)??{count:0,until:now+60_000};current.count++;attempts.set(address,current);
      if(current.count>30)return res.status(429).json({message:'Too many sign-in attempts. Try again in a minute'});
    }
    if (req.path === '/api/v1/auth/register' && req.method === 'POST') {
      const address=req.ip??'unknown';const now=Date.now();
      for(const [key,value] of signups)if(value.until<now)signups.delete(key);
      const current=signups.get(address)??{count:0,until:now+3_600_000};current.count++;signups.set(address,current);
      if(current.count>10)return res.status(429).json({message:'Too many sign-ups from this connection. Try again later'});
    }
    next();
  });
  // Optional single-process deployment: the API also serves the built web app (WEB_DIST), with a single-page-app fallback.
  const webDist = env.WEB_DIST ? path.resolve(env.WEB_DIST) : '';
  if (webDist && existsSync(path.join(webDist,'index.html'))) {
    app.use('/assets',express.static(path.join(webDist,'assets'),{immutable:true,maxAge:'1y',fallthrough:false}));
    app.use(express.static(webDist,{index:false,maxAge:0}));
    app.use((req:Request,res:Response,next:NextFunction) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path === '/healthz' || req.path === '/readyz') return next();
      res.setHeader('cache-control','no-cache');res.sendFile(path.join(webDist,'index.html'));
    });
  }
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();
  return app;
}
if (require.main === module) {
  createApp().then(async app => {
    // In production, refuse to start against a database that is behind the bundled migrations.
    if (process.env.NODE_ENV === 'production') await assertMigrated(app.get(Database).pool);
    const {port,host} = serverConfig();
    return app.listen(port,host);
  }).catch(error => { console.error(error instanceof Error ? error.message : 'Startup failed'); process.exit(1); });
}
