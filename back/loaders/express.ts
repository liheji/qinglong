import express, { Request, Response, NextFunction, Application } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import routes from '../api';
import config from '../config';
import { UnauthorizedError, expressjwt } from 'express-jwt';
import { getPlatform, getToken } from '../config/util';
import rewrite from 'express-urlrewrite';
import { errors } from 'celebrate';
import { serveEnv } from '../config/serverEnv';
import { IKeyvStore, shareStore } from '../shared/store';

export default ({ app }: { app: Application }) => {
  app.set('trust proxy', 'loopback');
  app.use(cors());
  app.get(`${config.api.prefix}/env.js`, serveEnv);
  app.use(`${config.api.prefix}/static`, express.static(config.uploadPath));

  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.use(
    expressjwt({
      secret: config.jwt.secret,
      algorithms: ['HS384'],
    }).unless({
      path: [...config.apiWhiteList, /^\/open\//],
    }),
  );

  app.use((req: Request, res, next) => {
    if (!req.headers) {
      req.platform = 'desktop';
    } else {
      const platform = getPlatform(req.headers['user-agent'] || '');
      req.platform = platform;
    }
    return next();
  });

  app.use(async (req: Request, res, next) => {
    const headerToken = getToken(req);
    if (req.path.startsWith('/open/')) {
      const apps = await shareStore.getApps();
      const doc = apps?.filter((x) =>
        x.tokens?.find((y) => y.value === headerToken),
      )?.[0];
      if (doc && doc.tokens && doc.tokens.length > 0) {
        const currentToken = doc.tokens.find((x) => x.value === headerToken);
        const keyMatch = req.path.match(/\/open\/([a-z]+)\/*/);
        const key = keyMatch && keyMatch[1];
        if (
          doc.scopes.includes(key as any) &&
          currentToken &&
          currentToken.expiration >= Math.round(Date.now() / 1000)
        ) {
          return next();
        }
      }
    }

    const originPath = `${req.baseUrl}${req.path === '/' ? '' : req.path}`;
    if (
      !headerToken &&
      originPath &&
      config.apiWhiteList.includes(originPath)
    ) {
      return next();
    }

    const authInfo = await shareStore.getAuthInfo();
    if (authInfo && headerToken) {
      const { token = '', tokens = {} } = authInfo;
      if (headerToken === token || tokens[req.platform] === headerToken) {
        return next();
      }
    }

    const errorCode = headerToken ? 'invalid_token' : 'credentials_required';
    const errorMessage = headerToken
      ? 'jwt malformed'
      : 'No authorization token was found';
    const err = new UnauthorizedError(errorCode, { message: errorMessage });
    next(err);
  });

  app.use(async (req, res, next) => {
    if (!['/api/user/init', '/api/user/notification/init'].includes(req.path)) {
      return next();
    }
    const authInfo =
      (await shareStore.getAuthInfo()) || ({} as IKeyvStore['authInfo']);

    let isInitialized = true;
    if (
      Object.keys(authInfo).length === 2 &&
      authInfo.username === 'admin' &&
      authInfo.password === 'admin'
    ) {
      isInitialized = false;
    }

    if (isInitialized) {
      return res.send({ code: 450, message: '未知错误' });
    } else {
      return next();
    }
  });

  app.use(rewrite('/open/*', '/api/$1'));
  app.use(config.api.prefix, routes());

  app.use((req, res, next) => {
    const err: any = new Error('Not Found');
    err['status'] = 404;
    next(err);
  });

  app.use(errors());

  app.use(
    (
      err: Error & { status: number },
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (err.name === 'UnauthorizedError') {
        return res
          .status(err.status)
          .send({ code: 401, message: err.message })
          .end();
      }
      return next(err);
    },
  );

  app.use(
    (
      err: Error & { errors: any[] },
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (err.name.includes('Sequelize')) {
        return res
          .status(500)
          .send({
            code: 400,
            message: `${err.message}`,
            errors: err.errors,
          })
          .end();
      }
      return next(err);
    },
  );

  app.use(
    (
      err: Error & { status: number },
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      res.status(err.status || 500);
      res.json({
        code: err.status || 500,
        message: err.message,
      });
    },
  );
};
