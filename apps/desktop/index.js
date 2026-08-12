import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  protocol,
  screen,
  shell,
  systemPreferences,
  webContents,
} from "electron";
import { execFile } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a$1;
function $constructor(name, initializer, params) {
  function init(inst, def) {
    if (!inst._zod)
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: /* @__PURE__ */ new Set(),
        },
        enumerable: false,
      });
    if (inst._zod.traits.has(name)) return;
    inst._zod.traits.add(name);
    initializer(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) inst[k] = proto[k].bind(inst);
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {}
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition() : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) fn();
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent) return true;
      return inst?._zod?.traits?.has(name);
    },
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig) Object.assign(globalConfig, newConfig);
  return globalConfig;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  return Object.entries(entries)
    .filter(([k, _]) => numericValues.indexOf(+k) === -1)
    .map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint") return value.toString();
  return value;
}
function cached$2(getter) {
  return {
    get value() {
      {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
    },
  };
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
var EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
  let value = void 0;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) return;
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, { value: v });
    },
    configurable: true,
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__*/ cached$2(() => {
  if (globalConfig.jitless) return false;
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare"))
    return false;
  try {
    new Function("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false) return false;
  const ctor = o.constructor;
  if (ctor === void 0) return true;
  if (typeof ctor !== "function") return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false) return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o)) return { ...o };
  if (Array.isArray(o)) return [...o];
  if (o instanceof Map) return new Map(o);
  if (o instanceof Set) return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__*/ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent) cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params) return {};
  if (typeof params === "string") return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return {
      ...params,
      error: () => params.error,
    };
  return params;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -Number.MAX_VALUE, Number.MAX_VALUE);
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  if (checks && checks.length > 0)
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  return clone(
    schema,
    mergeDefs(schema._zod.def, {
      get shape() {
        const newShape = {};
        for (const key in mask) {
          if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
          if (!mask[key]) continue;
          newShape[key] = currDef.shape[key];
        }
        assignProp(this, "shape", newShape);
        return newShape;
      },
      checks: [],
    }),
  );
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  if (checks && checks.length > 0)
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  return clone(
    schema,
    mergeDefs(schema._zod.def, {
      get shape() {
        const newShape = { ...schema._zod.def.shape };
        for (const key in mask) {
          if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
          if (!mask[key]) continue;
          delete newShape[key];
        }
        assignProp(this, "shape", newShape);
        return newShape;
      },
      checks: [],
    }),
  );
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
  const checks = schema._zod.def.checks;
  if (checks && checks.length > 0) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape)
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0)
        throw new Error(
          "Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.",
        );
  }
  return clone(
    schema,
    mergeDefs(schema._zod.def, {
      get shape() {
        const _shape = {
          ...schema._zod.def.shape,
          ...shape,
        };
        assignProp(this, "shape", _shape);
        return _shape;
      },
    }),
  );
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape))
    throw new Error("Invalid input to safeExtend: expected a plain object");
  return clone(
    schema,
    mergeDefs(schema._zod.def, {
      get shape() {
        const _shape = {
          ...schema._zod.def.shape,
          ...shape,
        };
        assignProp(this, "shape", _shape);
        return _shape;
      },
    }),
  );
}
function merge(a, b) {
  if (a._zod.def.checks?.length)
    throw new Error(
      ".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.",
    );
  return clone(
    a,
    mergeDefs(a._zod.def, {
      get shape() {
        const _shape = {
          ...a._zod.def.shape,
          ...b._zod.def.shape,
        };
        assignProp(this, "shape", _shape);
        return _shape;
      },
      get catchall() {
        return b._zod.def.catchall;
      },
      checks: b._zod.def.checks ?? [],
    }),
  );
}
function partial(Class, schema, mask) {
  const checks = schema._zod.def.checks;
  if (checks && checks.length > 0)
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  return clone(
    schema,
    mergeDefs(schema._zod.def, {
      get shape() {
        const oldShape = schema._zod.def.shape;
        const shape = { ...oldShape };
        if (mask)
          for (const key in mask) {
            if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
            if (!mask[key]) continue;
            shape[key] = Class
              ? new Class({
                  type: "optional",
                  innerType: oldShape[key],
                })
              : oldShape[key];
          }
        else
          for (const key in oldShape)
            shape[key] = Class
              ? new Class({
                  type: "optional",
                  innerType: oldShape[key],
                })
              : oldShape[key];
        assignProp(this, "shape", shape);
        return shape;
      },
      checks: [],
    }),
  );
}
function required(Class, schema, mask) {
  return clone(
    schema,
    mergeDefs(schema._zod.def, {
      get shape() {
        const oldShape = schema._zod.def.shape;
        const shape = { ...oldShape };
        if (mask)
          for (const key in mask) {
            if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
            if (!mask[key]) continue;
            shape[key] = new Class({
              type: "nonoptional",
              innerType: oldShape[key],
            });
          }
        else
          for (const key in oldShape)
            shape[key] = new Class({
              type: "nonoptional",
              innerType: oldShape[key],
            });
        assignProp(this, "shape", shape);
        return shape;
      },
    }),
  );
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true) return true;
  for (let i = startIndex; i < x.issues.length; i++)
    if (x.issues[i]?.continue !== true) return true;
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true) return true;
  for (let i = startIndex; i < x.issues.length; i++)
    if (x.issues[i]?.continue === false) return true;
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
  const message = iss.message
    ? iss.message
    : (unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ??
      unwrapMessage(ctx?.error?.(iss)) ??
      unwrapMessage(config.customError?.(iss)) ??
      unwrapMessage(config.localeError?.(iss)) ??
      "Invalid input");
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) rest.input = _input;
  return rest;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input)) return "array";
  if (typeof input === "string") return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string")
    return {
      message: iss,
      code: "custom",
      input,
      inst,
    };
  return { ...iss };
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
var initializer$1 = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false,
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false,
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false,
  });
};
var $ZodError = $constructor("$ZodError", initializer$1);
var $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues)
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else formErrors.push(mapper(sub));
  return {
    formErrors,
    fieldErrors,
  };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues)
      if (issue.code === "invalid_union" && issue.errors.length)
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      else if (issue.code === "invalid_key")
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      else if (issue.code === "invalid_element")
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
        else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
            else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
  };
  processError(error);
  return fieldErrors;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx
    ? {
        ..._ctx,
        async: false,
      }
    : { async: false };
  const result = schema._zod.run(
    {
      value,
      issues: [],
    },
    ctx,
  );
  if (result instanceof Promise) throw new $ZodAsyncError();
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(
      result.issues.map((iss) => finalizeIssue(iss, ctx, config())),
    );
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx
    ? {
        ..._ctx,
        async: true,
      }
    : { async: true };
  let result = schema._zod.run(
    {
      value,
      issues: [],
    },
    ctx,
  );
  if (result instanceof Promise) result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(
      result.issues.map((iss) => finalizeIssue(iss, ctx, config())),
    );
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx
    ? {
        ..._ctx,
        async: false,
      }
    : { async: false };
  const result = schema._zod.run(
    {
      value,
      issues: [],
    },
    ctx,
  );
  if (result instanceof Promise) throw new $ZodAsyncError();
  return result.issues.length
    ? {
        success: false,
        error: new (_Err ?? $ZodError)(
          result.issues.map((iss) => finalizeIssue(iss, ctx, config())),
        ),
      }
    : {
        success: true,
        data: result.value,
      };
};
var safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx
    ? {
        ..._ctx,
        async: true,
      }
    : { async: true };
  let result = schema._zod.run(
    {
      value,
      issues: [],
    },
    ctx,
  );
  if (result instanceof Promise) result = await result;
  return result.issues.length
    ? {
        success: false,
        error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config()))),
      }
    : {
        success: true,
        data: result.value,
      };
};
var safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx
    ? {
        ..._ctx,
        direction: "backward",
      }
    : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx
    ? {
        ..._ctx,
        direction: "backward",
      }
    : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx
    ? {
        ..._ctx,
        direction: "backward",
      }
    : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx
    ? {
        ..._ctx,
        direction: "backward",
      }
    : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
/**
 * @deprecated CUID v1 is deprecated by its authors due to information leakage
 * (timestamps embedded in the id). Use {@link cuid2} instead.
 * See https://github.com/paralleldrive/cuid.
 */
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
var duration$1 =
  /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
 *
 * @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(
    `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`,
  );
};
/** Practical email validation */
var email =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji$1, "u");
}
var ipv4 =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 =
  /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  return typeof args.precision === "number"
    ? args.precision === -1
      ? `${hhmm}`
      : args.precision === 0
        ? `${hhmm}:[0-5]\\d`
        : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}`
    : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
  const time = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local) opts.push("");
  if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string$1 = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
var $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ??
    (_a.when = (payload) => {
      const val = payload.value;
      return !nullish(val) && val.length !== void 0;
    });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (input.length <= def.maximum) return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ??
    (_a.when = (payload) => {
      const val = payload.value;
      return !nullish(val) && val.length !== void 0;
    });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (input.length >= def.minimum) return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ??
    (_a.when = (payload) => {
      const val = payload.value;
      return !nullish(val) && val.length !== void 0;
    });
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length) return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...(tooBig
        ? {
            code: "too_big",
            maximum: def.length,
          }
        : {
            code: "too_small",
            minimum: def.length,
          }),
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ??
      (_a.check = (payload) => {
        def.pattern.lastIndex = 0;
        if (def.pattern.test(payload.value)) return;
        payload.issues.push({
          origin: "string",
          code: "invalid_format",
          format: def.format,
          input: payload.value,
          ...(def.pattern ? { pattern: def.pattern.toString() } : {}),
          inst,
          continue: !def.abort,
        });
      });
  else (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value)) return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(
    typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex,
  );
  def.pattern = pattern;
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position)) return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix)) return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix)) return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this) this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const lines = arg.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines
      .map((x) => x.slice(minIndent))
      .map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) this.content.push(line);
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
    return new F(...args, lines.join("\n"));
  }
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3,
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
var $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...(inst._zod.def.checks ?? [])];
  if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
  for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload)) continue;
          if (!ch._zod.def.when(payload)) continue;
        } else if (isAborted) continue;
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
        if (asyncResult || _ instanceof Promise)
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            if (payload.issues.length === currLen) return;
            if (!isAborted) isAborted = aborted(payload, currLen);
          });
        else {
          if (payload.issues.length === currLen) continue;
          if (!isAborted) isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult)
        return asyncResult.then(() => {
          return payload;
        });
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false) throw new $ZodAsyncError();
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse(
          {
            value: payload.value,
            issues: [],
          },
          {
            ...ctx,
            skipChecks: true,
          },
        );
        if (canary instanceof Promise)
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false) throw new $ZodAsyncError();
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse$1(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync$1(inst, value).then((r) =>
          r.success ? { value: r.data } : { issues: r.error?.issues },
        );
      }
    },
    vendor: "zod",
    version: 1,
  }));
});
var $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...(inst?._zod.bag?.patterns ?? [])].pop() ?? string$1(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string") return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst,
    });
    return payload;
  };
});
var $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const v = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8,
    }[def.version];
    if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort,
          });
          return;
        }
      }
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname))
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort,
          });
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (
          !def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)
        )
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort,
          });
      }
      if (def.normalize) payload.value = url.href;
      else payload.value = trimmed;
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort,
      });
    }
  };
});
var $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
/**
 * @deprecated CUID v1 is deprecated by its authors due to information leakage
 * (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
 * See https://github.com/paralleldrive/cuid.
 */
var $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime$1(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date$1);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time$1(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration$1);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort,
      });
    }
  };
});
var $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2) throw new Error();
      const [address, prefix] = parts;
      if (!prefix) throw new Error();
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix) throw new Error();
      if (prefixNum < 0 || prefixNum > 128) throw new Error();
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort,
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "") return true;
  if (/\s/.test(data)) return false;
  if (data.length % 4 !== 0) return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value)) return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort,
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data)) return false;
  const base64 = data.replace(/[-_]/g, (c) => (c === "-" ? "+" : "/"));
  return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
var $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value)) return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3) return false;
    const [header] = tokensParts;
    if (!header) return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
    if (!parsedHeader.alg) return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg)) return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort,
    });
  };
});
var $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst,
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
  final.value[index] = result.value;
}
var $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst,
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run(
        {
          value: item,
          issues: [],
        },
        ctx,
      );
      if (result instanceof Promise)
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      else handleArrayResult(result, payload, i);
    }
    if (proms.length) return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) return;
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length)
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key],
      });
    return;
  }
  if (result.value === void 0) {
    if (isPresent) final.value[key] = void 0;
  } else final.value[key] = result.value;
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys)
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType"))
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys),
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__") continue;
    if (keySet.has(key)) continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run(
      {
        value: input[key],
        issues: [],
      },
      ctx,
    );
    if (r instanceof Promise)
      proms.push(
        r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)),
      );
    else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
  }
  if (unrecognized.length)
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
    });
  if (!proms.length) return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", { value: newSh });
        return newSh;
      },
    });
  }
  const _normalized = cached$2(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
        for (const v of field.values) propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject$1 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject$1(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst,
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run(
        {
          value: input[key],
          issues: [],
        },
        ctx,
      );
      if (r instanceof Promise)
        proms.push(
          r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)),
        );
      else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
    if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached$2(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) ids[key] = `key_${counter++}`;
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut)
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      else if (!isOptionalIn)
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      else
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject$2 = isObject;
  const jit = !globalConfig.jitless;
  const fastEnabled = jit && allowsEval.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject$2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst,
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass) fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall) return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results)
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config()))),
  });
  return final;
}
var $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () =>
    def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0,
  );
  defineLazy(inst._zod, "optout", () =>
    def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0,
  );
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values))
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) return first(payload, ctx);
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run(
        {
          value: payload.value,
          issues: [],
        },
        ctx,
      );
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0) return result;
        results.push(result);
      }
    }
    if (!async) return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run(
      {
        value: input,
        issues: [],
      },
      ctx,
    );
    const right = def.right._zod.run(
      {
        value: input,
        issues: [],
      },
      ctx,
    );
    if (left instanceof Promise || right instanceof Promise)
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b)
    return {
      valid: true,
      data: a,
    };
  if (a instanceof Date && b instanceof Date && +a === +b)
    return {
      valid: true,
      data: a,
    };
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = {
      ...a,
      ...b,
    };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid)
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath],
        };
      newObj[key] = sharedValue.data;
    }
    return {
      valid: true,
      data: newObj,
    };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      return {
        valid: false,
        mergeErrorPath: [],
      };
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid)
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath],
        };
      newArray.push(sharedValue.data);
    }
    return {
      valid: true,
      data: newArray,
    };
  }
  return {
    valid: false,
    mergeErrorPath: [],
  };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  for (const iss of left.issues)
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k)) unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else result.issues.push(iss);
  for (const iss of right.issues)
    if (iss.code === "unrecognized_keys")
      for (const k of iss.keys) {
        if (!unrecKeys.has(k)) unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    else result.issues.push(iss);
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue)
    result.issues.push({
      ...unrecIssue,
      keys: bothKeys,
    });
  if (aborted(result)) return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid)
    throw new Error(
      `Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`,
    );
  result.value = merged.data;
  return result;
}
var $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(
    `^(${values
      .filter((k) => propertyKeyTypes.has(typeof k))
      .map((o) => (typeof o === "string" ? escapeRegex(o) : o.toString()))
      .join("|")})$`,
  );
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) return payload;
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst,
    });
    return payload;
  };
});
var $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
    const _out = def.transform(payload.value, payload);
    if (ctx.async)
      return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    if (_out instanceof Promise) throw new $ZodAsyncError();
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === void 0 && (result.issues.length || result.fallback))
    return {
      issues: [],
      value: void 0,
    };
  return result;
}
var $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values
      ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0])
      : void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === void 0) return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values
      ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null])
      : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null) return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      /**
       * $ZodDefault returns the default value immediately in forward direction.
       * It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) payload.value = def.defaultValue;
  return payload;
}
var $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
    if (payload.value === void 0) payload.value = def.defaultValue;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise)
      return result.then((result) => handleNonOptionalResult(result, inst));
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0)
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst,
    });
  return payload;
}
var $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise)
      return result.then((result) => {
        payload.value = result.value;
        if (result.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
            input: payload.value,
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
        input: payload.value,
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
var $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise)
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run(
    {
      value: left.value,
      issues: left.issues,
      fallback: left.fallback,
    },
    ctx,
  );
}
var $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) return result.then(handleReadonlyResult);
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
    handleRefineResult(r, payload, input, inst);
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...(inst._zod.def.path ?? [])],
      continue: !inst._zod.def.abort,
    };
    if (inst._zod.def.params) _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...(this.get(p) ?? {}) };
      delete pm.id;
      const f = {
        ...pm,
        ...this._map.get(schema),
      };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
  return new Class({
    type: "string",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
/**
 * @deprecated CUID v1 is deprecated by its authors due to information leakage
 * (timestamps embedded in the id). Use {@link _cuid2} instead.
 * See https://github.com/paralleldrive/cuid.
 */
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
  return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  return new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum,
  });
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum,
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length,
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern,
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes,
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix,
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix,
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx,
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params),
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
  return new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params),
  });
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue$2) => {
      if (typeof issue$2 === "string")
        payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
      else {
        const _issue = issue$2;
        if (_issue.fatal) _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params),
  });
  ch._zod.check = fn;
  return ch;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4") target = "draft-04";
  if (target === "draft-7") target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? void 0,
  };
}
function process$1(
  schema,
  ctx,
  _params = {
    path: [],
    schemaPath: [],
  },
) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
    return seen.schema;
  }
  const result = {
    schema: {},
    count: 1,
    cycle: void 0,
    path: _params.path,
  };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) result.schema = overrideSchema;
  else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path,
    };
    if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
    else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor)
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref) result.ref = parent;
      process$1(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta) Object.assign(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0])
        throw new Error(
          `Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`,
        );
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) return { ref: uriGenerator(externalId) };
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return {
        defId: id,
        ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`,
      };
    }
    if (entry[1] === root) return { ref: "#" };
    const defUriPrefix = `#/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return {
      defId,
      ref: defUriPrefix + defId,
    };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) return;
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId) seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) delete schema[key];
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw")
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle)
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    if (ctx.metadataRegistry.get(entry[0])?.id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null) return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (
        refSchema.$ref &&
        (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")
      ) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else Object.assign(schema, refSchema);
      Object.assign(schema, _cached);
      if (zodSchema._zod.parent === ref)
        for (const key in schema) {
          if (key === "$ref" || key === "allOf") continue;
          if (!(key in _cached)) delete schema[key];
        }
      if (refSchema.$ref && refSeen.def)
        for (const key in schema) {
          if (key === "$ref" || key === "allOf") continue;
          if (
            key in refSeen.def &&
            JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])
          )
            delete schema[key];
        }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def)
          for (const key in schema) {
            if (key === "$ref" || key === "allOf") continue;
            if (
              key in parentSeen.def &&
              JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])
            )
              delete schema[key];
          }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? [],
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
  const result = {};
  if (ctx.target === "draft-2020-12")
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
  else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
  else if (ctx.target === "openapi-3.0") {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id) throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId) delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {
  } else if (Object.keys(defs).length > 0) {
    if (ctx.target === "draft-2020-12") result.$defs = defs;
    else result.definitions = defs;
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors),
        },
      },
      enumerable: false,
      writable: false,
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema)) return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform") return true;
  if (def.type === "array") return isTransforming(def.element, ctx);
  if (def.type === "set") return isTransforming(def.valueType, ctx);
  if (def.type === "lazy") return isTransforming(def.getter(), ctx);
  if (
    def.type === "promise" ||
    def.type === "optional" ||
    def.type === "nonoptional" ||
    def.type === "nullable" ||
    def.type === "readonly" ||
    def.type === "default" ||
    def.type === "prefault"
  )
    return isTransforming(def.innerType, ctx);
  if (def.type === "intersection")
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  if (def.type === "record" || def.type === "map")
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec")) return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) if (isTransforming(option, ctx)) return true;
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) if (isTransforming(item, ctx)) return true;
    if (def.rest && isTransforming(def.rest, ctx)) return true;
    return false;
  }
  return false;
}
/**
 * Creates a toJSONSchema method for a schema instance.
 * This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
 */
var createToJSONSchemaMethod =
  (schema, processors = {}) =>
  (params) => {
    const ctx = initializeContext({
      ...params,
      processors,
    });
    process$1(schema, ctx);
    extractDefs(ctx, schema);
    return finalize(ctx, schema);
  };
var createStandardJSONSchemaMethod =
  (schema, io, processors = {}) =>
  (params) => {
    const { libraryOptions, target } = params ?? {};
    const ctx = initializeContext({
      ...(libraryOptions ?? {}),
      target,
      io,
      processors,
    });
    process$1(schema, ctx);
    extractDefs(ctx, schema);
    return finalize(ctx, schema);
  };
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: "",
};
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number") json.minLength = minimum;
  if (typeof maximum === "number") json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "") delete json.format;
    if (format === "time") delete json.format;
  }
  if (contentEncoding) json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1) json.pattern = regexes[0].source;
    else if (regexes.length > 1)
      json.allOf = [
        ...regexes.map((regex) => ({
          ...(ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0"
            ? { type: "string" }
            : {}),
          pattern: regex.source,
        })),
      ];
  }
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number")) json.type = "number";
  if (values.every((v) => typeof v === "string")) json.type = "string";
  json.enum = values;
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw")
    throw new Error("Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw")
    throw new Error("Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number") json.minItems = minimum;
  if (typeof maximum === "number") json.maxItems = maximum;
  json.type = "array";
  json.items = process$1(def.element, ctx, {
    ...params,
    path: [...params.path, "items"],
  });
};
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;
  for (const key in shape)
    json.properties[key] = process$1(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key],
    });
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set(
    [...allKeys].filter((key) => {
      const v = def.shape[key]._zod;
      if (ctx.io === "input") return v.optin === void 0;
      else return v.optout === void 0;
    }),
  );
  if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
  if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
  else if (!def.catchall) {
    if (ctx.io === "output") json.additionalProperties = false;
  } else if (def.catchall)
    json.additionalProperties = process$1(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"],
    });
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) =>
    process$1(x, ctx, {
      ...params,
      path: [...params.path, isExclusive ? "oneOf" : "anyOf", i],
    }),
  );
  if (isExclusive) json.oneOf = options;
  else json.anyOf = options;
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = process$1(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0],
  });
  const b = process$1(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1],
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  json.allOf = [
    ...(isSimpleIntersection(a) ? a.allOf : [a]),
    ...(isSimpleIntersection(b) ? b.allOf : [b]),
  ];
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else json.anyOf = [inner, { type: "null" }];
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? (inIsTransform ? def.out : def.in) : def.out;
  process$1(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime(params) {
  return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date(params) {
  return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
var ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time(params) {
  return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
var ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration(params) {
  return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
var initializer = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: { value: (mapper) => formatError(inst, mapper) },
    flatten: { value: (mapper) => flattenError(inst, mapper) },
    addIssue: {
      value: (issue) => {
        inst.issues.push(issue);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      },
    },
    addIssues: {
      value: (issues) => {
        inst.issues.push(...issues);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      },
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      },
    },
  });
};
var ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
var parse = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = /* @__PURE__ */ new Set();
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group)) return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound,
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v,
        });
      },
    });
  }
}
var ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output"),
    },
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse(inst, data, params);
  inst.parseAsync = async (data, params) =>
    parseAsync(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def = this.def;
      return this.clone(
        mergeDefs(def, {
          checks: [
            ...(def.checks ?? []),
            ...chks.map((ch) =>
              typeof ch === "function"
                ? {
                    _zod: {
                      check: ch,
                      def: { check: "custom" },
                      onattach: [],
                    },
                  }
                : ch,
            ),
          ],
        }),
        { parent: true },
      );
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def, params) {
      return clone(this, def, params);
    },
    brand() {
      return this;
    },
    register(reg, meta) {
      reg.add(this, meta);
      return this;
    },
    refine(check, params) {
      return this.check(refine(check, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(/* @__PURE__ */ _overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0) return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(void 0).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    },
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true,
  });
  return inst;
});
/** @internal */
var _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(/* @__PURE__ */ _regex(...args));
    },
    includes(...args) {
      return this.check(/* @__PURE__ */ _includes(...args));
    },
    startsWith(...args) {
      return this.check(/* @__PURE__ */ _startsWith(...args));
    },
    endsWith(...args) {
      return this.check(/* @__PURE__ */ _endsWith(...args));
    },
    min(...args) {
      return this.check(/* @__PURE__ */ _minLength(...args));
    },
    max(...args) {
      return this.check(/* @__PURE__ */ _maxLength(...args));
    },
    length(...args) {
      return this.check(/* @__PURE__ */ _length(...args));
    },
    nonempty(...args) {
      return this.check(/* @__PURE__ */ _minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(/* @__PURE__ */ _lowercase(params));
    },
    uppercase(params) {
      return this.check(/* @__PURE__ */ _uppercase(params));
    },
    trim() {
      return this.check(/* @__PURE__ */ _trim());
    },
    normalize(...args) {
      return this.check(/* @__PURE__ */ _normalize(...args));
    },
    toLowerCase() {
      return this.check(/* @__PURE__ */ _toLowerCase());
    },
    toUpperCase() {
      return this.check(/* @__PURE__ */ _toUpperCase());
    },
    slugify() {
      return this.check(/* @__PURE__ */ _slugify());
    },
  });
});
var ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
  inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
  inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
  inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime(params));
  inst.date = (params) => inst.check(date(params));
  inst.time = (params) => inst.check(time(params));
  inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
  return /* @__PURE__ */ _string(ZodString, params);
}
var ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return /* @__PURE__ */ _url(ZodURL, params);
}
var ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
/**
 * @deprecated CUID v1 is deprecated by its authors due to information leakage
 * (timestamps embedded in the id). Use {@link ZodCUID2} instead.
 * See https://github.com/paralleldrive/cuid.
 */
var ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
  return /* @__PURE__ */ _unknown(ZodUnknown);
}
var ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return /* @__PURE__ */ _never(ZodNever, params);
}
var ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(/* @__PURE__ */ _minLength(n, params));
    },
    nonempty(params) {
      return this.check(/* @__PURE__ */ _minLength(1, params));
    },
    max(n, params) {
      return this.check(/* @__PURE__ */ _maxLength(n, params));
    },
    length(n, params) {
      return this.check(/* @__PURE__ */ _length(n, params));
    },
    unwrap() {
      return this.element;
    },
  });
});
function array(element, params) {
  return /* @__PURE__ */ _array(ZodArray, element, params);
}
var ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({
        ...this._zod.def,
        catchall,
      });
    },
    passthrough() {
      return this.clone({
        ...this._zod.def,
        catchall: unknown(),
      });
    },
    loose() {
      return this.clone({
        ...this._zod.def,
        catchall: unknown(),
      });
    },
    strict() {
      return this.clone({
        ...this._zod.def,
        catchall: never(),
      });
    },
    strip() {
      return this.clone({
        ...this._zod.def,
        catchall: void 0,
      });
    },
    extend(incoming) {
      return extend(this, incoming);
    },
    safeExtend(incoming) {
      return safeExtend(this, incoming);
    },
    merge(other) {
      return merge(this, other);
    },
    pick(mask) {
      return pick(this, mask);
    },
    omit(mask) {
      return omit(this, mask);
    },
    partial(...args) {
      return partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return required(ZodNonOptional, this, args[0]);
    },
  });
});
function object(shape, params) {
  return new ZodObject({
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params),
  });
}
var ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params),
  });
}
var ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) =>
    intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right,
  });
}
var ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values)
      if (keys.has(value)) newEntries[value] = def.entries[value];
      else throw new Error(`Key ${value} not found in enum`);
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries,
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values)
      if (keys.has(value)) delete newEntries[value];
      else throw new Error(`Key ${value} not found in enum`);
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries,
    });
  };
});
function _enum(values, params) {
  return new ZodEnum({
    type: "enum",
    entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
    ...normalizeParams(params),
  });
}
var ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
    payload.addIssue = (issue$1) => {
      if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
      else {
        const _issue = issue$1;
        if (_issue.fatal) _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise)
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn,
  });
}
var ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType,
  });
}
var ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType,
  });
}
var ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType,
  });
}
var ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    },
  });
}
var ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    },
  });
}
var ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) =>
    nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params),
  });
}
var ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue,
  });
}
var ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out,
  });
}
var ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType,
  });
}
var ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region ../../packages/env/src/create-env.ts
/**
 * Validates environment variables against zod schemas and returns a frozen,
 * fully-typed object.
 *
 * Throws at import time when a variable is missing or malformed, and throws on
 * access when client code reaches for a server-only variable.
 */
function createEnv(opts) {
  const {
    server = {},
    client = {},
    clientPrefix,
    runtimeEnv,
    isServer = typeof globalThis.window === "undefined",
    emptyStringAsUndefined = true,
    skipValidation = Boolean(runtimeEnv["SKIP_ENV_VALIDATION"]),
  } = opts;
  if (clientPrefix) {
    for (const key of Object.keys(client))
      if (!key.startsWith(clientPrefix))
        throw new Error(
          `[env] Client variable "${key}" must be prefixed with "${clientPrefix}", otherwise the bundler will not expose it.`,
        );
    for (const key of Object.keys(server))
      if (key.startsWith(clientPrefix))
        throw new Error(
          `[env] Server variable "${key}" must not use the public "${clientPrefix}" prefix — move it to \`client\` or rename it.`,
        );
  }
  const raw = {};
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (emptyStringAsUndefined && value === "") continue;
    if (value === void 0) continue;
    raw[key] = value;
  }
  const shape = isServer
    ? {
        ...client,
        ...server,
      }
    : { ...client };
  if (skipValidation) return Object.freeze(raw);
  const parsed = object(shape).safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `[env] Invalid environment variables:\n${details}\n\nCheck your .env against .env.example, or set SKIP_ENV_VALIDATION=1 to bypass.`,
    );
  }
  const values = parsed.data;
  return new Proxy(values, {
    get(target, prop) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (prop === "__esModule" || prop === "$$typeof" || prop === "then") return void 0;
      if (!isServer && !(prop in client))
        throw new Error(
          `[env] "${prop}" is a server-only environment variable and cannot be read from client code. Move it to the \`client\` schema if it is safe to expose.`,
        );
      return Reflect.get(target, prop);
    },
    set(_target, prop) {
      throw new Error(`[env] Environment is read-only (tried to set "${String(prop)}").`);
    },
  });
}
//#endregion
//#region ../../packages/env/src/env.ts
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to add an environment variable.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Add it to `server` (secret) or `client` (safe to expose).
 *  2. Add the matching line to `runtimeEnv` below — bundlers only inline env
 *     accesses they can see written out literally.
 *  3. Document it in the root `.env.example`.
 *
 *  Then read it anywhere with:  import { env } from "@prequel/env"
 */
/** Public variables must carry this prefix so Next.js/Vite will expose them. */
var CLIENT_PREFIX = "NEXT_PUBLIC_";
/** Never sent to the browser or the Electron renderer. */
var server = {
  NODE_ENV: _enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: url().optional(),
  API_SECRET: string().min(1).optional(),
};
/** Safe to ship to the client. Treat everything here as public. */
var client = {
  NEXT_PUBLIC_APP_NAME: string().min(1).default("Prequel"),
  NEXT_PUBLIC_APP_URL: url().default("http://localhost:3000"),
};
function build() {
  return createEnv({
    server,
    client,
    clientPrefix: CLIENT_PREFIX,
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      API_SECRET: process.env.API_SECRET,
      NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  });
}
var cached$1;
/**
 * Validates immediately and returns the env. Call this at process startup
 * (next.config.ts, Electron main) so a bad config fails the build/boot rather
 * than the first request.
 */
function validateEnv() {
  cached$1 ??= build();
  return cached$1;
}
/**
 * The environment, validated on first property access.
 *
 * Access is lazy so that merely importing this module from a context without
 * `process` — the Electron renderer, a browser bundle — does not blow up. Those
 * contexts build their own env from the exported `client` schema instead.
 */
var env = new Proxy(
  {},
  {
    get: (_target, prop) => Reflect.get(validateEnv(), prop),
    has: (_target, prop) => prop in validateEnv(),
    ownKeys: () => Reflect.ownKeys(validateEnv()),
    getOwnPropertyDescriptor: (_target, prop) =>
      Reflect.getOwnPropertyDescriptor(validateEnv(), prop),
  },
);
//#endregion
//#region src/shared/contract.ts
var DEFAULT_PREFERENCES = {
  mode: "screen",
  cameraId: null,
  cameraLabel: null,
  micId: null,
  micLabel: null,
  systemAudio: true,
  showCursor: true,
  cameraPosition: null,
};
/**
 * A device label with Chromium's USB ids stripped — `"FaceTime HD Camera
 * (05ac:8514)"` becomes `"FaceTime HD Camera"`.
 *
 * Chromium builds `MediaDeviceInfo.label` by appending those ids to the name
 * the system uses. They are noise in the panel, and they are the reason a
 * label never compares equal to AVFoundation's `localizedName` — so the same
 * rule has to serve both the display and the lookup.
 */
function withoutDeviceIds(label) {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
}
var IPC_CHANNELS = {
  appInfo: "app:info",
  screenPermission: "permissions:screen",
  requestScreenPermission: "permissions:requestScreen",
  listSources: "sources:list",
  sessionState: "session:state",
  sessionStart: "session:start",
  sessionStop: "session:stop",
  sessionTogglePause: "session:togglePause",
  revealRecordings: "library:reveal",
  closePopover: "popover:close",
  selectionChoose: "selection:choose",
  selectionCancel: "selection:cancel",
  /** Main → selection renderer, once per overlay. */
  selectionSetup: "selection:setup",
  chooseMode: "dock:chooseMode",
  startRecording: "dock:startRecording",
  preferences: "prefs:get",
  updatePreferences: "prefs:update",
  ensureDeviceAccess: "devices:ensureAccess",
  /** Renderer → main: a drop-up opened or closed, so the window can make room. */
  dockMenu: "dock:menu",
  /** Renderer → main: the panel's natural width, so the window can match it. */
  dockWidth: "dock:width",
  /** Renderer → main: the camera preview failed, or recovered. */
  cameraError: "dock:cameraError",
  /** Main → renderer broadcast. */
  dockChanged: "dock:changed",
  /** Main → renderer broadcast. */
  sessionChanged: "session:changed",
  /** Main → editor renderer, once per window. */
  editorOpen: "editor:open",
  editorSaveProject: "editor:saveProject",
  editorWallpaper: "editor:wallpaper",
  editorPickImage: "editor:pickImage",
  exportStart: "export:start",
  exportCancel: "export:cancel",
  /** Main → renderer broadcast. */
  exportProgress: "export:progress",
};
//#endregion
//#region src/main/app-icons.ts
/**
 * Full-resolution app icons for the window picker.
 *
 * Every API that hands an icon straight over caps out at 32×32 — measured, not
 * assumed: `desktopCapturer`'s `appIcon` is 32px, `app.getFileIcon` offers
 * 16 and 32 (and crashes on `"large"`, which macOS does not support), and
 * `nativeImage.createFromPath` returns an empty image for a `.icns` because it
 * cannot decode that format at all.
 *
 * The only place a large icon exists is the app bundle's own `.icns`, which
 * carries every size up to 1024. So: find the icon file the bundle declares,
 * and let `sips` — on every Mac since forever — render it at the size the
 * picker actually draws.
 */
var run$1 = promisify(execFile);
/**
 * Rendered edge, in pixels.
 *
 * Comfortably above the card's drawn size at 2x, so the icon stays sharp on a
 * Retina display without decoding a 1024px image for every window.
 */
var ICON_PIXELS = 256;
/** Long enough to fail fast on a hung helper, short enough not to stall the picker. */
var TIMEOUT_MS = 3e3;
/**
 * Icons already extracted this session, keyed by bundle path.
 *
 * Apps do not change their icon while running, and the picker is opened over
 * and over — without this, every open would re-shell out for the same handful
 * of apps.
 */
var cache = /* @__PURE__ */ new Map();
/**
 * Data URLs for the given app bundles, keyed by bundle path.
 *
 * Bundles that yield nothing are simply absent; the picker draws a name
 * without an icon rather than failing.
 */
async function iconsFor(bundlePaths) {
  const wanted = [...new Set(bundlePaths)].filter(Boolean);
  const missing = wanted.filter((path) => !cache.has(path));
  await Promise.all(
    missing.map(async (path) => {
      try {
        cache.set(path, await extract(path));
      } catch {
        cache.set(path, null);
      }
    }),
  );
  const icons = /* @__PURE__ */ new Map();
  for (const path of wanted) {
    const icon = cache.get(path);
    if (icon) icons.set(path, icon);
  }
  return icons;
}
/** Renders a bundle's icon to a PNG data URL. */
async function extract(bundlePath) {
  const icns = await icnsPath(bundlePath);
  if (!icns) return null;
  const scratch = mkdtempSync(join(tmpdir(), "prequel-icon-"));
  const out = join(scratch, "icon.png");
  try {
    await run$1(
      "/usr/bin/sips",
      ["-s", "format", "png", "-Z", String(ICON_PIXELS), icns, "--out", out],
      { timeout: TIMEOUT_MS },
    );
    return `data:image/png;base64,${readFileSync(out).toString("base64")}`;
  } finally {
    rmSync(scratch, {
      recursive: true,
      force: true,
    });
  }
}
/** The `.icns` a bundle declares in its Info.plist. */
async function icnsPath(bundlePath) {
  const { stdout } = await run$1(
    "/usr/bin/plutil",
    ["-extract", "CFBundleIconFile", "raw", "-o", "-", join(bundlePath, "Contents", "Info.plist")],
    { timeout: TIMEOUT_MS },
  );
  const declared = stdout.trim();
  if (!declared) return null;
  const file = declared.endsWith(".icns") ? declared : `${declared}.icns`;
  return join(bundlePath, "Contents", "Resources", basename(file));
}
//#endregion
//#region src/main/recorder.ts
/** Error codes the native layer prefixes onto its messages. */
var RecorderErrorCode = {
  ScreenAccessDenied: "SCREEN_ACCESS_DENIED",
  Timeout: "TIMEOUT",
  DisplayNotFound: "DISPLAY_NOT_FOUND",
  DisplayAsleep: "DISPLAY_ASLEEP",
  WindowNotFound: "WINDOW_NOT_FOUND",
  ScreenCaptureKit: "SCREEN_CAPTURE_KIT",
  Encode: "ENCODE",
  AlreadyRecording: "ALREADY_RECORDING",
  NotRecording: "NOT_RECORDING",
  UnknownCodec: "UNKNOWN_CODEC",
  CameraNotFound: "CAMERA_NOT_FOUND",
  CameraUnavailable: "CAMERA_UNAVAILABLE",
  RecorderPoisoned: "RECORDER_POISONED",
};
/**
 * Splits a native error into its machine-readable code and human message.
 *
 * The Rust side formats errors as `CODE: message`; the code lets the UI branch
 * (e.g. show a "grant permission" flow) without matching on prose.
 */
function describeRecorderError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const separator = raw.indexOf(": ");
  if (separator === -1)
    return {
      code: null,
      message: raw,
    };
  const candidate = raw.slice(0, separator);
  return Object.values(RecorderErrorCode).includes(candidate)
    ? {
        code: candidate,
        message: raw.slice(separator + 2),
      }
    : {
        code: null,
        message: raw,
      };
}
var cached = null;
/**
 * Loads the native recorder, or a fake when `PREQUEL_FAKE_RECORDER=1`.
 *
 * The fake exists so end-to-end runs can drive the whole UI on a machine
 * without the Screen Recording grant — hosted CI can never have it.
 */
async function getRecorder() {
  if (cached) return cached;
  cached =
    process.env["PREQUEL_FAKE_RECORDER"] === "1"
      ? await loadFake()
      : await import("@prequel/recorder");
  return cached;
}
async function loadFake() {
  const { createFakeRecorder } = await import("./recorder.fake-DFlfECWG.js");
  return createFakeRecorder();
}
//#endregion
//#region src/main/windows/base.ts
/**
 * Shared window construction.
 *
 * Every window Prequel shows while recording has the same two requirements: it
 * must float above the app being recorded without stealing focus from it, and
 * it must be excludable from the capture itself.
 */
var PRELOAD = fileURLToPath(new URL("../preload/index.mjs", import.meta.url));
var RENDERER_HTML = fileURLToPath(new URL("../renderer/index.html", import.meta.url));
/**
 * A frameless, transparent, non-activating window.
 *
 * `type: "panel"` is the important flag: it makes the window an NSPanel, which
 * can receive clicks and drags *without activating Prequel*. Without it, every
 * click on the recording controls would pull focus away from the app the user
 * is recording — which would be visible in the recording.
 */
function createPanel(options = {}) {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    type: "panel",
    ...options,
    webPreferences: {
      preload: PRELOAD,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      ...options.webPreferences,
    },
  });
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return window;
}
/**
 * An ordinary application window.
 *
 * Everything else Prequel shows is a non-activating `NSPanel`, because it has
 * to float over the app being recorded without stealing focus from it. The
 * editor is the opposite case: it is the thing the user is working in, so it
 * takes focus, resizes, and behaves like a document window. Sharing the panel
 * factory would make it unfocusable and unresizable.
 */
function createWindow(options = {}) {
  const window = new BrowserWindow({
    show: false,
    titleBarStyle: "hiddenInset",
    ...options,
    webPreferences: {
      preload: PRELOAD,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      ...options.webPreferences,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return window;
}
/**
 * Points a window at a renderer route.
 *
 * All windows share one HTML entry and route on the hash, so electron-vite's
 * dev server and HMR work the same for every one of them.
 */
function loadRoute(window, route) {
  const devServer = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServer) return window.loadURL(`${devServer}#${route}`);
  return window.loadFile(RENDERER_HTML, { hash: route });
}
/**
 * The window's `CGWindowID`.
 *
 * Needed so ScreenCaptureKit can be told to leave our own UI out of the
 * recording. Electron's `setContentProtection(true)` sets `NSWindowSharingNone`,
 * which ScreenCaptureKit ignores on current macOS — passing the id into the
 * content filter is the only thing that actually works.
 *
 * `getMediaSourceId()` returns `"window:<CGWindowID>:0"`.
 */
function windowId(window) {
  const parsed = Number.parseInt(window.getMediaSourceId().split(":")[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}
//#endregion
//#region src/main/windows/selection.ts
/**
 * The overlay used to pick a window or drag out an area.
 *
 * Only shown for the modes that need it — choosing "entire screen" needs no
 * overlay at all. One window per display, so it works the same on a laptop and
 * on a multi-monitor desk.
 */
var SelectionOverlay = class {
  panes = [];
  pending = null;
  /** The mode currently on screen, so a refresh can re-describe it. */
  mode = "screen";
  get isOpen() {
    return this.panes.length > 0;
  }
  /**
   * Resolves with the chosen target, or `null` if the user cancelled.
   *
   * `icons` maps a `CGWindowID` to its app icon; missing entries simply render
   * without one.
   */
  open(mode, targets, icons = /* @__PURE__ */ new Map()) {
    this.settle(null);
    this.mode = mode;
    return new Promise((resolve) => {
      this.pending = resolve;
      for (const display of screen.getAllDisplays())
        this.panes.push({
          window: this.createFor(display, mode, targets, icons),
          display,
        });
      if (this.panes.length === 0) this.settle(null);
    });
  }
  /**
   * Replaces what the overlays are showing.
   *
   * The window list is a snapshot taken before the overlay opened, and it goes
   * stale the moment anything moves: bring another window forward while the
   * picker is up and it is still described in its old position, or in its old
   * place in the stack. Pushing a fresh list keeps the picker honest about what
   * is actually on screen.
   */
  update(targets, icons = /* @__PURE__ */ new Map()) {
    for (const { window, display } of this.panes) {
      if (window.isDestroyed()) continue;
      window.webContents.send(
        IPC_CHANNELS.selectionSetup,
        describe(display, this.mode, targets, icons),
      );
    }
  }
  choose(result) {
    this.settle(result);
  }
  cancel() {
    this.settle(null);
  }
  close() {
    for (const { window } of this.panes) if (!window.isDestroyed()) window.destroy();
    this.panes = [];
  }
  browserWindows() {
    return this.panes.map((pane) => pane.window);
  }
  settle(result) {
    const resolve = this.pending;
    this.pending = null;
    this.close();
    resolve?.(result);
  }
  createFor(display, mode, targets, icons) {
    const window = createPanel({
      ...display.bounds,
      alwaysOnTop: true,
    });
    window.setAlwaysOnTop(true, "screen-saver");
    window.setFullScreenable(false);
    loadRoute(window, "/selection").then(() => {
      window.webContents.send(IPC_CHANNELS.selectionSetup, describe(display, mode, targets, icons));
      window.showInactive();
      window.focus();
    });
    return window;
  }
};
/**
 * One overlay's view of its display.
 *
 * Electron reports geometry in device-independent points with a global origin;
 * the renderer draws in CSS pixels local to its own window. Everything is
 * rebased here, so that conversion lives in exactly one place.
 */
function describe(display, mode, targets, icons) {
  const { bounds } = display;
  const windows = targets
    .filter((target) => target.kind === "Window" && intersects(target.bounds, bounds))
    .map((target) => ({
      target,
      rect: {
        x: target.bounds.x - bounds.x,
        y: target.bounds.y - bounds.y,
        width: target.bounds.width,
        height: target.bounds.height,
      },
      ...(icons.has(target.id) ? { icon: icons.get(target.id) } : {}),
    }));
  return {
    mode,
    displayId: display.id,
    displayLabel: display.label || `Display ${display.id}`,
    width: bounds.width,
    height: bounds.height,
    scaleFactor: display.scaleFactor,
    screenTarget: screenTargetFor(display),
    windows,
  };
}
/**
 * The "this whole screen" target, built from Electron's own display.
 *
 * Deliberately not looked up in ScreenCaptureKit's list: that list omits a
 * display entirely while it is asleep, and Electron already knows the id — which
 * *is* the `CGDirectDisplayID` on macOS — along with the bounds and scale.
 */
function screenTargetFor(display) {
  const { bounds } = display;
  const pixels = (value) => Math.round(value * display.scaleFactor);
  return {
    kind: "Display",
    id: display.id,
    title: `Display ${pixels(bounds.width)}×${pixels(bounds.height)}`,
    appName: "",
    appPath: "",
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
    scaleFactor: display.scaleFactor,
  };
}
function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
//#endregion
//#region src/main/capture-flow.ts
/**
 * The setup-then-record flow behind the bottom panel.
 *
 * Sequencing matters in a way that is easy to get wrong: every window of ours
 * that will be on screen during the recording must exist *before* capture
 * starts, because its `CGWindowID` is what keeps it out of the frame. A window
 * created afterwards will be recorded.
 */
/**
 * How often the window picker re-reads what is on screen.
 *
 * The list it opens with is a snapshot, and it is stale as soon as anything
 * moves — a window brought forward keeps its old place in the stack until the
 * picker is reopened. Listing costs ~20 ms, so this is comfortably cheap
 * enough to run while the overlay is up, and slow enough not to churn.
 */
var WINDOW_REFRESH_MS = 700;
/**
 * Finds the AVFoundation camera behind a label the panel picked up from
 * `navigator.mediaDevices`.
 *
 * Exported for tests: this is the join between two device namespaces that do
 * not agree, and getting it wrong means the camera is silently absent.
 */
function matchCamera(label, cameras) {
  const stripped = withoutDeviceIds(label);
  return (
    cameras.find((camera) => camera.name === label) ??
    cameras.find((camera) => camera.name === stripped) ??
    cameras.find((camera) => stripped.startsWith(camera.name))
  );
}
/**
 * App icons for a set of window targets, keyed by `CGWindowID`.
 *
 * Goes via each window's owning bundle rather than `desktopCapturer`, whose
 * `appIcon` is 32×32 and looks it at any size worth drawing.
 */
async function windowIcons(targets) {
  const windows = targets.filter((target) => target.kind === "Window" && target.appPath);
  const byBundle = await iconsFor(windows.map((target) => target.appPath));
  const icons = /* @__PURE__ */ new Map();
  for (const target of windows) {
    const icon = byBundle.get(target.appPath);
    if (icon) icons.set(target.id, icon);
  }
  return icons;
}
var CaptureFlow = class {
  deps;
  pending = null;
  selecting = false;
  cameraError = null;
  activeMode = null;
  refreshing = false;
  /**
   * Which selection is the current one.
   *
   * Choosing a mode while a picker is already up cancels the first, and that
   * cancellation resolves inside the *older* call — whose cleanup would
   * otherwise clear `selecting` for the picker that just replaced it.
   */
  selectionRun = 0;
  constructor(deps) {
    this.deps = deps;
    this.deps.session.subscribe(() => this.emit());
    this.deps.camera.restore(this.deps.preferences.get().cameraPosition);
    this.deps.camera.onMove((cameraPosition) => {
      this.deps.preferences.update({ cameraPosition });
    });
    this.syncCamera();
  }
  /** Where preferences are stored. */
  preferencesPath() {
    return this.deps.preferences.path;
  }
  state() {
    const session = this.deps.session.snapshot();
    return {
      view: session.status === "idle" ? "setup" : "recording",
      preferences: this.deps.preferences.get(),
      activeMode: this.activeMode,
      selection: this.pending,
      session,
      selecting: this.selecting,
      cameraError: this.cameraError,
    };
  }
  /**
   * Brings the panel back without opening a picker.
   *
   * Separate from `open` because closing the editor should return the user to
   * the panel, not drop a full-screen overlay over the screen they were just
   * looking at.
   */
  showDock() {
    this.deps.dock.show();
    this.syncCamera();
    this.emit();
  }
  open() {
    this.showDock();
    this.chooseMode(this.deps.preferences.get().mode).catch((cause) => {
      console.warn("[flow] could not open the picker:", cause);
    });
  }
  /** Opens a recording for editing, hiding the recorder's floating UI. */
  openEditor(dir) {
    this.deps.editors?.open(dir);
  }
  /**
   * An editor took over. The panel, the bubble and any picker get out of the
   * way — they exist to set up a recording, and the user is now editing one.
   */
  editorOpened() {
    this.deps.selection.cancel();
    this.deps.dock.hide();
    this.deps.camera.hide();
  }
  /** The last editor closed, so the panel comes back. */
  editorClosed() {
    this.showDock();
  }
  toggle() {
    if (this.deps.dock.isVisible) this.close();
    else this.open();
  }
  updatePreferences(patch) {
    if ("cameraId" in patch) this.cameraError = null;
    this.deps.preferences.update(patch);
    this.emit();
    this.syncCamera();
    return this.state();
  }
  /**
   * Records that the camera preview failed, or recovered.
   *
   * Reported by the bubble because it is the only part of the app that
   * actually opens the device: a camera can be listed and still refuse to
   * open, and the panel would otherwise show it as on.
   */
  reportCameraError(message) {
    if (this.cameraError === message) return this.state();
    this.cameraError = message;
    this.emit();
    return this.state();
  }
  /** Sizes the panel to the width the renderer measured. */
  setPanelWidth(width) {
    this.deps.dock.setContentWidth(width);
  }
  /** Makes room above the panel for a drop-up, or takes it back. */
  setMenuOpen(open) {
    this.deps.dock.setMenuOpen(open);
  }
  /** Shows or hides the camera bubble to match the chosen device. */
  syncCamera() {
    if (this.deps.preferences.get().cameraId) this.deps.camera.show();
    else this.deps.camera.hide();
  }
  /**
   * Switches capture mode and opens the overlay for it.
   *
   * Every mode gets one, including "entire screen": it is what shows the
   * outline of exactly what will be recorded, at what resolution, before any
   * of it is committed — and on a second monitor it is the only way to say
   * which screen, rather than silently taking whichever one the cursor was on.
   */
  async chooseMode(mode) {
    this.deps.preferences.update({ mode });
    const run = ++this.selectionRun;
    this.pending = null;
    this.activeMode = mode;
    this.selecting = true;
    this.emit();
    let start = false;
    const refresh =
      mode === "window" ? setInterval(() => void this.refreshTargets(), WINDOW_REFRESH_MS) : null;
    try {
      const targets = await (await getRecorder()).listTargets();
      const result = await this.deps.selection.open(
        mode,
        targets,
        mode === "window" ? await windowIcons(targets) : void 0,
      );
      if (result) {
        this.pending = {
          mode,
          target: result.target,
          crop: result.crop,
          label: result.label,
        };
        start = result.start === true;
      } else if (run === this.selectionRun) this.activeMode = null;
    } finally {
      if (refresh) clearInterval(refresh);
      if (run === this.selectionRun) {
        this.selecting = false;
        this.emit();
      }
    }
    if (run !== this.selectionRun) return this.state();
    if (start) return this.record();
    return this.state();
  }
  /**
   * Pushes a fresh window list to an open picker.
   *
   * Skipped while a previous refresh is still in flight: listing is fast but
   * not instant, and queueing them up would make the picker lag further and
   * further behind the screen it is describing.
   */
  async refreshTargets() {
    if (this.refreshing || !this.deps.selection.isOpen) return;
    this.refreshing = true;
    try {
      const targets = await (await getRecorder()).listTargets();
      if (!this.deps.selection.isOpen) return;
      this.deps.selection.update(targets, await windowIcons(targets));
    } catch (cause) {
      console.warn("[picker] could not refresh windows:", cause);
    } finally {
      this.refreshing = false;
    }
  }
  /** Starts recording whatever the panel is set up to capture. */
  async record() {
    if (this.deps.session.isBusy()) return this.state();
    const selection = this.pending ?? {
      mode: "screen",
      target: screenTargetFor(screen.getDisplayNearestPoint(screen.getCursorScreenPoint())),
      crop: null,
      label: "Entire screen",
    };
    const preferences = this.deps.preferences.get();
    const dock = this.deps.dock.prepare();
    const camera = this.deps.camera.prepare();
    await this.deps.session.start({
      target: selection.target,
      crop: selection.crop,
      showCursor: preferences.showCursor,
      systemAudio: preferences.systemAudio,
      microphone: preferences.micId !== null,
      camera: preferences.cameraId ? await this.nativeCameraId(preferences.cameraLabel) : null,
      excludedWindowIds: this.excludedIds([dock, camera]),
    });
    this.deps.dock.setView("recording");
    this.deps.dock.show();
    this.emit();
    return this.state();
  }
  /** Pauses or resumes, whichever applies. */
  async togglePause() {
    await this.deps.session.togglePause();
    this.emit();
  }
  close() {
    this.deps.selection.cancel();
    this.deps.dock.hide();
    this.deps.camera.hide();
  }
  async stop() {
    await this.deps.session.stop();
    this.deps.dock.setView("setup");
    this.emit();
    const finished = this.deps.session.snapshot().lastResult;
    if (!finished) return;
    try {
      this.openEditor(finished.outputPath);
    } catch (cause) {
      console.warn("[flow] could not open the editor:", cause);
    }
  }
  /** Stops if recording, otherwise opens the panel ready to start. */
  async toggleRecording() {
    if (this.deps.session.isBusy()) {
      await this.stop();
      return;
    }
    if (this.deps.selection.isOpen) {
      this.deps.selection.cancel();
      return;
    }
    this.open();
  }
  cancelSelection() {
    this.deps.selection.cancel();
  }
  chooseSelection(result) {
    this.deps.selection.choose(result);
  }
  emit() {
    this.deps.onChange(this.state());
  }
  /**
   * Resolves the panel's camera label to an AVFoundation device.
   *
   * Returns null when nothing matches, and records why. Recording the screen
   * without the bubble beats refusing to record at all — the take is the part
   * that cannot be redone.
   */
  async nativeCameraId(label) {
    if (!label) return null;
    const match = matchCamera(label, (await getRecorder()).listCameras());
    if (match) return match.id;
    this.cameraError = `${label} is not available to record`;
    return null;
  }
  /**
   * `CGWindowID`s of every window of ours that could be on screen.
   *
   * `setContentProtection(true)` is not an option: it sets
   * `NSWindowSharingNone`, which ScreenCaptureKit deliberately ignores on
   * current macOS. Passing ids into the content filter is the only mechanism
   * that actually removes our UI from the recording.
   */
  excludedIds(extra) {
    const ids = /* @__PURE__ */ new Set();
    for (const window of [...extra, ...this.deps.selection.browserWindows()]) {
      if (!window || window.isDestroyed()) continue;
      const id = windowId(window);
      if (id !== null) ids.add(id);
    }
    return [...ids];
  }
};
//#endregion
//#region src/shared/presets.ts
var FRAME_PRESETS = [
  {
    id: "16:9",
    label: "Landscape 16:9",
    group: "General",
    width: 1920,
    height: 1080,
  },
  {
    id: "16:9-4k",
    label: "Landscape 4K",
    group: "General",
    width: 3840,
    height: 2160,
  },
  {
    id: "9:16",
    label: "Vertical 9:16",
    group: "General",
    width: 1080,
    height: 1920,
  },
  {
    id: "1:1",
    label: "Square 1:1",
    group: "General",
    width: 1080,
    height: 1080,
  },
  {
    id: "4:5",
    label: "Portrait 4:5",
    group: "General",
    width: 1080,
    height: 1350,
  },
  {
    id: "youtube",
    label: "YouTube",
    group: "Social",
    width: 1920,
    height: 1080,
  },
  {
    id: "shorts",
    label: "YouTube Shorts",
    group: "Social",
    width: 1080,
    height: 1920,
  },
  {
    id: "tiktok",
    label: "TikTok",
    group: "Social",
    width: 1080,
    height: 1920,
  },
  {
    id: "reels",
    label: "Instagram Reels",
    group: "Social",
    width: 1080,
    height: 1920,
  },
  {
    id: "instagram",
    label: "Instagram Feed",
    group: "Social",
    width: 1080,
    height: 1350,
  },
  {
    id: "x",
    label: "X",
    group: "Social",
    width: 1920,
    height: 1080,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    group: "Social",
    width: 1920,
    height: 1080,
  },
];
var DEFAULT_PRESET_ID = "16:9";
function findPreset(id) {
  return id === null ? void 0 : FRAME_PRESETS.find((preset) => preset.id === id);
}
/** Frame sizes must be even: H.264 chroma subsampling cannot encode an odd edge. */
function evenSize(value, min = 16, max = 7680) {
  return Math.min(Math.max(Math.round(value), min), max) & -2;
}
var PROJECT_FILE_NAME = "project.json";
var DEFAULT_LAYOUT = {
  screenFit: "contain",
  screenZoom: 1,
  screenOffsetX: 0,
  screenOffsetY: 0,
  cameraVisible: true,
  cameraShape: "circle",
  cameraSize: 0.22,
  cameraMargin: 0.04,
  cameraCorner: "bottom-left",
  cameraMirror: true,
};
/** The wallpaper file main copies into a recording. */
var WALLPAPER_FILE_NAME = "background.png";
/**
 * What a background falls back to when the desktop picture cannot be captured.
 *
 * Kept separate from `DEFAULT_BACKGROUND` because main substitutes it while
 * building a fresh project, and a missing image would otherwise render as a
 * flat placeholder that looks like a bug.
 */
var FALLBACK_BACKGROUND = {
  kind: "gradient",
  from: "#5433ff",
  to: "#20bdff",
  angle: 135,
};
var DEFAULT_BACKGROUND = {
  background: {
    kind: "image",
    source: "wallpaper",
    path: WALLPAPER_FILE_NAME,
  },
  padding: 0.06,
  cornerRadius: 0.02,
  borderWidth: 0,
  borderColor: "#ffffff",
  shadowOpacity: 0.45,
  shadowBlur: 0.05,
  shadowY: 0.015,
};
var DEFAULT_AUDIO = {
  micVolume: 1,
  micMuted: false,
  systemVolume: 1,
  systemMuted: false,
};
var DEFAULT_SETTINGS = {
  layout: DEFAULT_LAYOUT,
  background: DEFAULT_BACKGROUND,
  audio: DEFAULT_AUDIO,
};
/** A fresh project for a recording that has never been edited. */
function newProject(recordingId, duration) {
  const preset = findPreset(DEFAULT_PRESET_ID);
  return {
    version: 1,
    recordingId,
    frame: {
      width: preset.width,
      height: preset.height,
      presetId: preset.id,
    },
    defaults: structuredClone(DEFAULT_SETTINGS),
    tracks: [
      {
        id: "composite",
        kind: "composite",
        slices: [
          {
            id: "take",
            source: {
              start: 0,
              end: duration,
            },
            overrides: {},
          },
        ],
      },
    ],
    output: {
      fps: 60,
      codec: "h264",
    },
  };
}
/**
 * Repairs a project read off disk.
 *
 * A hand-edited or partially-written `project.json` must not brick the editor:
 * anything unrecognised falls back to a default rather than throwing, and only
 * a version mismatch is fatal. Same posture as the preferences file.
 *
 * Returns null when the file cannot be used at all, so the caller can start
 * fresh instead of guessing.
 */
function sanitiseProject(value, recordingId, duration) {
  if (typeof value !== "object" || value === null) return null;
  const stored = value;
  if (stored.version !== 1) return null;
  if (stored.recordingId !== recordingId) return null;
  const fresh = newProject(recordingId, duration);
  const width = evenSize(number(stored.frame?.width, fresh.frame.width));
  const height = evenSize(number(stored.frame?.height, fresh.frame.height));
  const slices = (stored.tracks?.[0]?.slices ?? [])
    .filter((slice) => typeof slice?.id === "string")
    .map((slice) => ({
      id: slice.id,
      source: {
        start: clamp(number(slice.source?.start, 0), 0, duration),
        end: clamp(number(slice.source?.end, duration), 0, duration),
      },
      overrides: slice.overrides ?? {},
    }))
    .filter((slice) => slice.source.end > slice.source.start);
  return {
    version: 1,
    recordingId,
    frame: {
      width,
      height,
      presetId: stored.frame?.presetId ?? null,
    },
    defaults: {
      layout: {
        ...DEFAULT_LAYOUT,
        ...stored.defaults?.layout,
      },
      background: {
        ...DEFAULT_BACKGROUND,
        ...stored.defaults?.background,
      },
      audio: {
        ...DEFAULT_AUDIO,
        ...stored.defaults?.audio,
      },
    },
    tracks: [
      {
        id: "composite",
        kind: "composite",
        slices: slices.length > 0 ? slices : fresh.tracks[0].slices,
      },
    ],
    output: {
      fps: clamp(number(stored.output?.fps, 60), 1, 120),
      codec: stored.output?.codec === "hevc" ? "hevc" : "h264",
    },
  };
}
function number(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
//#endregion
//#region src/main/editor-project.ts
/**
 * `project.json`, beside the recording it edits.
 *
 * Kept in the session directory rather than in app support, so a recording is
 * one self-contained folder: move it to another machine and the cuts, the
 * background and the audio mix move with it.
 *
 * Written atomically, and held in memory until then. An editor is closed by
 * closing its window, which does not wait for a promise — so the last edit is
 * flushed synchronously on the way out rather than being raced by teardown.
 */
/** Projects received but not yet on disk, keyed by session directory. */
var pending = /* @__PURE__ */ new Map();
function pathFor(dir) {
  return join(dir, PROJECT_FILE_NAME);
}
/**
 * Loads a recording's project, or makes a fresh one.
 *
 * Never throws for a missing, corrupt or incompatible file: the recording is
 * the irreplaceable part, and refusing to open an editor over a bad sidecar
 * would strand it. A file that cannot be used is replaced by defaults, which
 * the next save then overwrites.
 */
function loadProject(dir, recordingId, duration) {
  const held = pending.get(dir);
  if (held) return held;
  let raw;
  try {
    raw = readFileSync(pathFor(dir), "utf8");
  } catch {
    return newProject(recordingId, duration);
  }
  try {
    return (
      sanitiseProject(JSON.parse(raw), recordingId, duration) ?? newProject(recordingId, duration)
    );
  } catch (cause) {
    console.warn(`[editor] ignoring unreadable ${PROJECT_FILE_NAME} in ${dir}:`, cause);
    return newProject(recordingId, duration);
  }
}
/**
 * Records the latest project and writes it.
 *
 * Held as well as written so that a close arriving between two debounced saves
 * still has something to flush.
 */
function saveProject(dir, project) {
  pending.set(dir, project);
  write$1(dir, project);
}
/** Writes anything still held for a directory, then forgets it. */
function flushProject(dir) {
  const project = pending.get(dir);
  if (!project) return;
  write$1(dir, project);
  pending.delete(dir);
}
/**
 * Writes through a temporary file.
 *
 * A crash partway through a direct write leaves a truncated `project.json`,
 * which is a lost edit rather than a corrupt one only because `loadProject`
 * falls back — this keeps it from happening at all.
 */
function write$1(dir, project) {
  const path = pathFor(dir);
  const temporary = `${path}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(project, null, 2));
    renameSync(temporary, path);
  } catch (cause) {
    console.warn(`[editor] could not save ${path}:`, cause);
    try {
      unlinkSync(temporary);
    } catch {}
  }
}
var MANIFEST_FILE_NAME = "session.json";
/** The file each kind is written to, inside a session directory. */
var TRACK_FILE_NAMES = {
  screen: "screen.mp4",
  camera: "camera.mp4",
  microphone: "mic.m4a",
  system_audio: "system.m4a",
};
var ManifestError = class extends Error {};
/**
 * Parses a manifest, refusing anything this build does not understand.
 *
 * The version check is the point: silently editing a manifest written by a
 * newer build would produce an export that is wrong in ways nothing downstream
 * could detect.
 */
function parseManifest(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new ManifestError(`session.json is not valid JSON: ${String(cause)}`);
  }
  if (typeof value !== "object" || value === null)
    throw new ManifestError("session.json is not an object");
  const manifest = value;
  if (manifest.version !== 1)
    throw new ManifestError(
      `session.json is version ${String(manifest.version)}, this build understands 1`,
    );
  if (!Array.isArray(manifest.tracks)) throw new ManifestError("session.json has no tracks");
  return manifest;
}
//#endregion
//#region src/main/session.ts
/**
 * Owns the app-wide recording lifecycle.
 *
 * Recording can be triggered from several places at once — the tray menu, the
 * popover, a global hotkey, the floating pill — so the decision of what a
 * command means lives here rather than in any one of them. Everything else
 * observes and reacts.
 */
/**
 * Where recordings are written.
 *
 * Overridable so tests and end-to-end runs write to a scratch directory
 * instead of the user's real Movies folder.
 */
var RECORDINGS_DIR = process.env["PREQUEL_RECORDINGS_DIR"] ?? join(homedir(), "Movies", "Prequel");
var RecordingSession = class {
  load;
  status = "idle";
  target = null;
  outputPath = null;
  error = null;
  lastResult = null;
  excludedWindowIds = [];
  startedAt = 0;
  pausedAt = 0;
  pausedTotal = 0;
  listeners = /* @__PURE__ */ new Set();
  constructor(load = getRecorder) {
    this.load = load;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }
  snapshot() {
    return {
      status: this.status,
      target: this.target,
      elapsedMs: this.elapsedMs(),
      outputPath: this.outputPath,
      error: this.error,
      lastResult: this.lastResult,
      excludedWindowIds: this.excludedWindowIds,
    };
  }
  isBusy() {
    return this.status !== "idle";
  }
  async start(options) {
    if (this.status !== "idle") return;
    this.status = "starting";
    this.error = null;
    this.lastResult = null;
    this.emit();
    const outputPath = newRecordingPath();
    const request = {
      targetKind: options.target.kind,
      targetId: options.target.id,
      bounds: options.target.bounds,
      scaleFactor: options.target.scaleFactor,
      crop: options.crop ?? void 0,
      outputPath,
      fps: options.fps ?? 60,
      showCursor: options.showCursor ?? true,
      systemAudio: options.systemAudio ?? false,
      microphone: options.microphone ?? false,
      camera: options.camera ?? void 0,
      startedAt: /* @__PURE__ */ new Date().toISOString(),
      excludedWindowIds: options.excludedWindowIds ?? [],
    };
    try {
      await (await this.load()).startRecording(request);
    } catch (cause) {
      this.status = "idle";
      this.target = null;
      this.outputPath = null;
      this.error = describeRecorderError(cause);
      this.emit();
      throw cause;
    }
    this.status = "recording";
    this.target = options.target;
    this.excludedWindowIds = request.excludedWindowIds ?? [];
    this.outputPath = outputPath;
    this.startedAt = Date.now();
    this.pausedTotal = 0;
    this.emit();
  }
  async pause() {
    if (this.status !== "recording") return;
    (await this.load()).pauseRecording();
    this.pausedAt = Date.now();
    this.status = "paused";
    this.emit();
  }
  async resume() {
    if (this.status !== "paused") return;
    (await this.load()).resumeRecording();
    this.pausedTotal += Date.now() - this.pausedAt;
    this.status = "recording";
    this.emit();
  }
  /** Pauses or resumes, whichever applies. */
  async togglePause() {
    if (this.status === "recording") return this.pause();
    if (this.status === "paused") return this.resume();
  }
  async stop() {
    if (this.status !== "recording" && this.status !== "paused") return null;
    if (this.status === "paused") this.pausedTotal += Date.now() - this.pausedAt;
    this.status = "stopping";
    this.emit();
    const outputPath = this.outputPath;
    try {
      const result = await (await this.load()).stopRecording();
      this.lastResult = outputPath
        ? {
            ...result,
            outputPath,
          }
        : null;
      return result;
    } catch (cause) {
      this.error = describeRecorderError(cause);
      return null;
    } finally {
      this.status = "idle";
      this.target = null;
      this.outputPath = null;
      this.excludedWindowIds = [];
      this.emit();
    }
  }
  /** Starts if idle, stops if recording — what a single hotkey should do. */
  async toggle(options) {
    if (this.status === "idle") await this.start(options);
    else await this.stop();
  }
  elapsedMs() {
    if (this.status === "idle" || this.status === "starting") return 0;
    const paused =
      this.status === "paused" ? this.pausedTotal + (Date.now() - this.pausedAt) : this.pausedTotal;
    return Math.max(0, Date.now() - this.startedAt - paused);
  }
  emit() {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }
};
/**
 * A directory for one recording's tracks.
 *
 * A session is several files — screen, camera, microphone, system audio — so
 * the output is a folder rather than a single video. Keeping them together is
 * what makes the set reassemblable later.
 */
function newRecordingPath(now = /* @__PURE__ */ new Date(), dir = RECORDINGS_DIR) {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace("T", " ").slice(0, 19);
  return join(dir, `Prequel ${stamp}`);
}
/**
 * Reveals a recording, or the recordings folder, in Finder.
 *
 * The folder is created first: `shell.openPath` fails silently on a path that
 * does not exist, so before the first recording the menu item would appear to
 * do nothing at all.
 */
async function revealRecordings(path) {
  if (path) {
    shell.showItemInFolder(path);
    return;
  }
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const error = await shell.openPath(RECORDINGS_DIR);
  if (error) console.warn(`[library] could not open ${RECORDINGS_DIR}: ${error}`);
}
/**
 * Past recordings, newest first.
 *
 * A directory only counts if it holds a manifest: an interrupted take can leave
 * a folder with a half-written screen track and nothing describing it, and
 * offering that as something to open would only produce an error on click.
 *
 * Sorted by the manifest's own mtime rather than the directory's, which macOS
 * touches for reasons that have nothing to do with when the take was made.
 */
function recentRecordings(limit = 10, dir = RECORDINGS_DIR) {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (cause) {
    console.warn(`[library] could not read ${dir}:`, cause);
    return [];
  }
  const recordings = [];
  for (const name of entries) {
    const path = join(dir, name);
    try {
      recordings.push({
        dir: path,
        name,
        modifiedAt: statSync(join(path, MANIFEST_FILE_NAME)).mtimeMs,
      });
    } catch {}
  }
  return recordings.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
}
//#endregion
//#region src/main/export.ts
/**
 * Running one export at a time, and telling the editor how it is going.
 *
 * The heavy lifting is in `prequel-render`; this owns the job's lifecycle, so
 * that a second Export press cannot start a competing render and a closed
 * window cannot leave one running with nobody listening.
 */
/** What an export is called inside its recording's own folder. */
var EXPORT_FILE_NAME = "export.mp4";
/** The directory currently being exported, or null. */
var running = null;
/**
 * Starts an export.
 *
 * Rejects a second one rather than queueing: there is one GPU and one encoder,
 * and two concurrent renders would fight over both while making each other
 * slower.
 */
async function startExport(request) {
  if (running) throw new Error("ALREADY_EXPORTING: an export is already running");
  const output = join(request.dir, EXPORT_FILE_NAME);
  running = request.dir;
  try {
    (await getRecorder()).startExport(
      {
        sessionDir: request.dir,
        output,
        width: request.width,
        height: request.height,
        fps: request.fps,
        codec: request.codec,
        slices: request.slices.map((slice) => ({
          start: slice.start,
          end: slice.end,
          plan: JSON.stringify(slice.plan),
          micVolume: slice.micVolume,
          systemVolume: slice.systemVolume,
        })),
        screenOffset: request.offsets.screen,
        cameraOffset: request.offsets.camera,
        micOffset: request.offsets.microphone,
        systemOffset: request.offsets.system_audio,
      },
      (error, progress) => {
        if (error) {
          finish({
            stage: "failed",
            framesDone: 0,
            framesTotal: 0,
            outputPath: null,
            error: {
              code: null,
              message: error.message,
            },
          });
          return;
        }
        const update = {
          stage: progress.stage,
          framesDone: progress.framesDone,
          framesTotal: progress.framesTotal,
          outputPath: progress.outputPath ?? null,
          error: progress.message
            ? {
                code: null,
                message: progress.message,
              }
            : null,
        };
        if (update.stage === "done" || update.stage === "failed" || update.stage === "cancelled") {
          finish(update);
          return;
        }
        broadcast(update);
      },
    );
  } catch (cause) {
    running = null;
    throw cause;
  }
}
/** Asks the running export to stop. Safe to call when nothing is running. */
async function cancelExport() {
  if (!running) return;
  (await getRecorder()).cancelExport();
}
function finish(update) {
  running = null;
  broadcast(update);
  if (update.stage === "done" && update.outputPath) revealRecordings(update.outputPath);
}
/**
 * Pushes progress to every live renderer.
 *
 * Broadcast rather than sent to one window, matching how panel state already
 * travels — and the editor that started the export is not necessarily the only
 * thing that should know it finished.
 */
function broadcast(progress) {
  for (const contents of webContents.getAllWebContents())
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.exportProgress, progress);
}
//#endregion
//#region src/shared/media-url.ts
/**
 * The shape of a `prequel-media://` URL, defined once.
 *
 * Main serves these and the renderer requests them, so both have to agree on
 * the encoding exactly — a mismatch is a 404 that looks like a missing file.
 * Deliberately free of any `electron` or Node import so both can use it.
 */
var MEDIA_SCHEME = "prequel-media";
/**
 * A URL for one file inside a recording.
 *
 * `recording` is the session directory's *name*, never its path: the handler
 * resolves it against the recordings directory and refuses anything that lands
 * outside, so a full path here would simply be rejected.
 */
function mediaUrl$1(recording, fileName) {
  return `${MEDIA_SCHEME}://recording/${encodeURIComponent(recording)}/${encodeURIComponent(fileName)}`;
}
//#endregion
//#region src/main/media-protocol.ts
/**
 * Serves recorded media to the editor's renderer.
 *
 * A renderer cannot read `file:` URLs — the CSP forbids it and sandboxed
 * renderers have no filesystem access — so the recordings are reached through a
 * scheme of our own. Two things about it are load-bearing:
 *
 * Range requests. Without a `206` for a `Range` header, Chromium cannot seek a
 * video: playback works for as long as the buffer lasts and then simply stops.
 * `net.fetch` over a `file:` URL is the one-line alternative and does not
 * reliably honour Range, which is why this reads the header itself.
 *
 * The traversal guard. The URL is entirely renderer-controlled, and the
 * renderer is the least-trusted process in the app. Every resolved path is
 * checked to be inside the recordings directory before anything is opened.
 */
/**
 * The URL for one file inside a recording directory.
 *
 * Takes a path where the shared builder takes a name, because everything in
 * main holds the full directory — and the URL must carry only the name, since
 * the handler resolves it against the recordings directory itself.
 */
function mediaUrl(dir, fileName) {
  return mediaUrl$1(basename(dir), fileName);
}
/**
 * Privileges the scheme needs, registered before `app.whenReady`.
 *
 * `stream` is the one that matters: without it Chromium will not issue range
 * requests at all, and a `<video>` cannot seek.
 */
var MEDIA_SCHEME_PRIVILEGES = {
  scheme: MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
};
/** Only what a session directory can legitimately contain. */
var ALLOWED = /\.(mp4|m4a|png|jpg|jpeg)$/i;
/**
 * Resolves a media URL to a path inside the recordings directory.
 *
 * Returns null for anything outside it. `resolve` first, then compare: a name
 * like `../../..` only reveals itself as an escape once it has been resolved,
 * and comparing the raw string would let it through.
 */
function resolveMediaPath(url, root = RECORDINGS_DIR) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (parts.length !== 2) return null;
  const [recording, fileName] = parts;
  if (!ALLOWED.test(fileName)) return null;
  const path = resolve(join(root, recording, fileName));
  const base = resolve(root);
  if (path !== base && !path.startsWith(base + sep)) return null;
  return path;
}
/** Parses a `Range` header of the form `bytes=start-end`. */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart) {
    if (!rawEnd) return null;
    const length = Math.min(Number(rawEnd), size);
    return length <= 0
      ? null
      : {
          start: size - length,
          end: size - 1,
        };
  }
  const start = Number(rawStart);
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  if (start > end || start >= size) return null;
  return {
    start,
    end,
  };
}
function contentType(path) {
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".m4a")) return "audio/mp4";
  if (path.endsWith(".png")) return "image/png";
  return "image/jpeg";
}
/** Serves one request. Exported so the routing can be tested without Electron. */
function serveMedia(url, rangeHeader, root) {
  const path = resolveMediaPath(url, root);
  if (!path) return new Response("Not found", { status: 404 });
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers = {
    "Content-Type": contentType(path),
    "Accept-Ranges": "bytes",
  };
  const range = parseRange(rangeHeader, size);
  if (!range)
    return new Response(toWebStream(createReadStream(path)), {
      status: 200,
      headers: {
        ...headers,
        "Content-Length": String(size),
      },
    });
  const { start, end } = range;
  return new Response(
    toWebStream(
      createReadStream(path, {
        start,
        end,
      }),
    ),
    {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    },
  );
}
function toWebStream(stream) {
  return Readable.toWeb(stream);
}
/** Registers the handler. Call inside `app.whenReady`. */
function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request.url, request.headers.get("Range")));
}
//#endregion
//#region src/main/wallpaper.ts
/**
 * Backgrounds, copied into the recording that uses them.
 *
 * Copied rather than referenced, and that is the important part: the desktop
 * picture changes tomorrow, and an export has to produce the same video it
 * produced today. It also makes a recording directory self-contained, which is
 * what lets it move between machines.
 *
 * Reading the *current* wallpaper is harder than it should be on macOS 14+.
 * `~/Library/Application Support/Dock/desktoppicture.db` is legacy and often
 * absent; the current store, `com.apple.wallpaper/Store/Index.plist`, leaves
 * its `Files` array empty for the stock pictures and hides the real identity
 * inside an NSKeyedArchiver blob; `NSWorkspace.desktopImageURL(for:)` is not
 * bound by cidre and returns a multi-image dynamic HEIC anyway; and
 * `osascript` needs an Automation grant that fails confusingly.
 *
 * So the plist is only a fast path, for the case where the user picked their
 * own image and it is named outright. Anything else falls back to a real
 * screenshot of the wallpaper window, which Prequel is uniquely able to take
 * because it already holds the Screen Recording grant — and which is correct
 * for dynamic and video wallpapers, where there is no still file to find.
 */
var run = promisify(execFile);
/** Longest edge of a copied background. A 6K wallpaper is not worth keeping. */
var MAX_EDGE = 2560;
var WALLPAPER_INDEX = join(
  homedir(),
  "Library",
  "Application Support",
  "com.apple.wallpaper",
  "Store",
  "Index.plist",
);
/**
 * Puts the current desktop picture into a recording.
 *
 * Returns null when it cannot be found at all, so the option can simply be
 * absent rather than failing — the same posture `app-icons.ts` takes, where a
 * sandbox refusal is not worth failing the whole picker over.
 */
async function captureWallpaper(dir) {
  return capture(dir, { reuse: false });
}
/**
 * Makes sure a recording has a wallpaper to use as its default background.
 *
 * Reuses the copy already in the directory rather than re-capturing: the
 * default is meant to be what the desktop looked like when the recording was
 * made, and re-taking it on every open would silently restyle an old edit the
 * next time the user changed their wallpaper.
 */
async function ensureWallpaper(dir) {
  return (await capture(dir, { reuse: true })) !== null;
}
async function capture(dir, options) {
  const destination = join(dir, WALLPAPER_FILE_NAME);
  if (options.reuse && existsSync(destination)) return described(dir, WALLPAPER_FILE_NAME);
  const named = await namedWallpaperFile();
  if (named) {
    if (await convert(named, destination)) return described(dir, WALLPAPER_FILE_NAME);
  }
  try {
    await (await getRecorder()).captureWallpaper(0, destination);
    await convert(destination, destination);
    return described(dir, WALLPAPER_FILE_NAME);
  } catch (cause) {
    console.warn("[wallpaper] could not capture the desktop:", cause);
    return null;
  }
}
/**
 * Lets the user choose their own background image.
 *
 * Copied in under a stable name so the project can reference it relatively.
 */
async function pickBackgroundImage(dir) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose a background",
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "heic", "heif"],
      },
    ],
  });
  const source = filePaths[0];
  if (canceled || !source) return null;
  const name = "background-custom.png";
  const destination = join(dir, name);
  if (await convert(source, destination)) return described(dir, name);
  try {
    copyFileSync(source, destination);
    return described(dir, name);
  } catch (cause) {
    console.warn("[wallpaper] could not copy the chosen image:", cause);
    return null;
  }
}
/**
 * The wallpaper's own file, when the store names one.
 *
 * Only true when the user picked their own picture. The stock ones report a
 * `default` provider with an empty file list, which is why this is a fast path
 * rather than the mechanism.
 */
async function namedWallpaperFile() {
  if (!existsSync(WALLPAPER_INDEX)) return null;
  try {
    const { stdout } = await run("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      WALLPAPER_INDEX,
    ]);
    return (
      [...stdout.matchAll(/"relative":"(file:[^"]+)"/g)]
        .map((match) => match[1])
        .map((url) => {
          try {
            return decodeURIComponent(new URL(url).pathname);
          } catch {
            return null;
          }
        })
        .find((path) => path !== null && existsSync(path)) ?? null
    );
  } catch (cause) {
    console.warn("[wallpaper] could not read the wallpaper store:", cause);
    return null;
  }
}
/** Flattens and downscales to a PNG the renderer can draw cheaply. */
async function convert(source, destination) {
  try {
    await run("/usr/bin/sips", [
      "-s",
      "format",
      "png",
      "-Z",
      String(MAX_EDGE),
      source,
      "--out",
      destination,
    ]);
    return existsSync(destination);
  } catch (cause) {
    console.warn(`[wallpaper] could not convert ${source}:`, cause);
    return false;
  }
}
function described(dir, name) {
  return {
    path: name,
    url: mediaUrl(dir, name),
  };
}
//#endregion
//#region src/main/ipc.ts
/**
 * Every `ipcMain` handler, in one place.
 *
 * Handlers never reject on an expected condition — a denied permission, nothing
 * recording, a cancelled selection. Those come back as a tagged result the
 * renderer can act on, so the UI can show a recovery path instead of an
 * unhandled promise rejection.
 */
/** Runs an operation, turning a native failure into a tagged result. */
async function attempt(operation) {
  try {
    return {
      ok: true,
      value: await operation(),
    };
  } catch (cause) {
    return {
      ok: false,
      ...describeRecorderError(cause),
    };
  }
}
function registerIpc({ flow }) {
  ipcMain.handle(IPC_CHANNELS.appInfo, () => ({
    name: env.NEXT_PUBLIC_APP_NAME,
    url: env.NEXT_PUBLIC_APP_URL,
    nodeEnv: env.NODE_ENV,
    version: app.getVersion(),
    recordingsDir: RECORDINGS_DIR,
    preferencesFile: flow.preferencesPath(),
  }));
  ipcMain.handle(IPC_CHANNELS.screenPermission, async () =>
    (await getRecorder()).screenAccessStatus(),
  );
  ipcMain.handle(IPC_CHANNELS.requestScreenPermission, async () =>
    (await getRecorder()).requestScreenAccess(),
  );
  ipcMain.handle(IPC_CHANNELS.listSources, () =>
    attempt(async () => (await getRecorder()).listTargets()),
  );
  ipcMain.handle(IPC_CHANNELS.sessionState, () => flow.state());
  ipcMain.handle(IPC_CHANNELS.preferences, () => flow.state().preferences);
  ipcMain.handle(IPC_CHANNELS.updatePreferences, (_event, patch) => flow.updatePreferences(patch));
  ipcMain.handle(IPC_CHANNELS.chooseMode, (_event, mode) => attempt(() => flow.chooseMode(mode)));
  ipcMain.handle(IPC_CHANNELS.startRecording, () => attempt(() => flow.record()));
  ipcMain.handle(IPC_CHANNELS.sessionStop, () => attempt(() => flow.stop()));
  ipcMain.handle(IPC_CHANNELS.sessionTogglePause, () => attempt(() => flow.togglePause()));
  ipcMain.handle(IPC_CHANNELS.selectionChoose, (_event, result) => flow.chooseSelection(result));
  ipcMain.handle(IPC_CHANNELS.selectionCancel, () => flow.cancelSelection());
  /**
   * Asks macOS for camera or mic access.
   *
   * Device *labels* are only exposed to `enumerateDevices` once access is
   * granted, so the dropups would otherwise show a list of anonymous entries.
   */
  ipcMain.handle(IPC_CHANNELS.ensureDeviceAccess, async (_event, kind) => {
    if (systemPreferences.getMediaAccessStatus(kind) === "granted") return true;
    return systemPreferences.askForMediaAccess(kind);
  });
  ipcMain.handle(IPC_CHANNELS.dockMenu, (_event, open) => flow.setMenuOpen(open));
  ipcMain.handle(IPC_CHANNELS.dockWidth, (_event, width) => flow.setPanelWidth(width));
  ipcMain.handle(IPC_CHANNELS.cameraError, (_event, message) => flow.reportCameraError(message));
  ipcMain.handle(IPC_CHANNELS.revealRecordings, (_event, path) => revealRecordings(path));
  ipcMain.handle(IPC_CHANNELS.closePopover, () => flow.close());
  ipcMain.handle(IPC_CHANNELS.editorSaveProject, (_event, dir, project) =>
    attempt(() => saveProject(dir, project)),
  );
  ipcMain.handle(IPC_CHANNELS.editorWallpaper, (_event, dir) =>
    attempt(() => captureWallpaper(dir)),
  );
  ipcMain.handle(IPC_CHANNELS.editorPickImage, (_event, dir) =>
    attempt(() => pickBackgroundImage(dir)),
  );
  ipcMain.handle(IPC_CHANNELS.exportStart, (_event, request) =>
    attempt(() => startExport(request)),
  );
  ipcMain.handle(IPC_CHANNELS.exportCancel, () => attempt(() => cancelExport()));
}
/** Pushes panel state to every live renderer. */
function broadcastDockState(state) {
  for (const contents of webContents.getAllWebContents())
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.dockChanged, state);
}
//#endregion
//#region src/main/log.ts
/**
 * A log file, because a packaged app has no console.
 *
 * `pnpm dev` prints to the terminal; a build dropped into /Applications prints
 * into the void. Anything that only goes wrong once installed — a missing
 * resource, a permission refused, a quit that never completes — is invisible
 * without somewhere on disk to look afterwards.
 *
 * Deliberately small and synchronous. This has to survive the moments it exists
 * for: an uncaught exception, and `will-quit`, where an async write would be
 * cut off by the process exiting.
 */
/** Rolled over past this, so one long-running session cannot fill a disk. */
var MAX_BYTES = 2097152;
var file = null;
/** Where the log lives. `~/Library/Logs/Prequel/main.log` on macOS. */
function logPath() {
  if (file) return file;
  const dir = app.getPath("logs");
  mkdirSync(dir, { recursive: true });
  file = join(dir, "main.log");
  return file;
}
/**
 * Starts logging, and routes crashes into the file.
 *
 * Call once, as early as possible — the interesting failures happen during
 * startup, before any window exists to report them.
 */
function initLogging() {
  try {
    rollOver();
  } catch {}
  for (const level of ["warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      write(level, args.map(format).join(" "));
    };
  }
  process.on("uncaughtException", (error) => {
    log("error", "uncaught exception", error);
  });
  process.on("unhandledRejection", (reason) => {
    log("error", "unhandled rejection", reason);
  });
  log("info", `— session start — ${app.getName()} ${app.getVersion()}`, {
    packaged: app.isPackaged,
    electron: process.versions["electron"],
    platform: `${process.platform} ${process.arch}`,
  });
}
/**
 * Writes one line. Never throws: logging must not be the thing that fails.
 *
 * For anything a developer should also trip over, prefer `console.warn` or
 * `console.error` — those are mirrored here *and* reach the terminal under
 * `pnpm dev`. This is for the lifecycle breadcrumbs that would only be noise
 * there.
 */
function log(level, message, detail) {
  write(level, `${message}${detail === void 0 ? "" : ` ${format(detail)}`}`);
}
function write(level, message) {
  try {
    appendFileSync(
      logPath(),
      `${/* @__PURE__ */ new Date().toISOString()} [${level}] ${message}\n`,
    );
  } catch {}
}
/** Errors carry a stack; everything else is JSON, falling back to `String`. */
function format(value) {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
/** Keeps one previous log, so a crash-on-launch loop cannot erase the cause. */
function rollOver() {
  const path = logPath();
  if (statSync(path).size < MAX_BYTES) return;
  renameSync(path, `${path}.1`);
}
//#endregion
//#region src/main/preferences.ts
/**
 * Persisted recording setup.
 *
 * The panel preselects whatever was used last, so the common case — the same
 * screen, camera and mic as yesterday — is one click. Stored as plain JSON in
 * the app's userData directory; there is not enough here to justify a database
 * or a dependency.
 */
var SCREEN_MODES = ["screen", "window", "area"];
var Preferences = class {
  file;
  cached = null;
  constructor(file = defaultFile()) {
    this.file = file;
  }
  /** Where settings are stored. Surfaced so it can be inspected or reported. */
  get path() {
    return this.file;
  }
  get() {
    this.cached ??= this.read();
    return this.cached;
  }
  update(patch) {
    const next = sanitise({
      ...this.get(),
      ...patch,
    });
    this.cached = next;
    this.write(next);
    return next;
  }
  read() {
    try {
      return sanitise(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }
  write(preferences) {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(preferences, null, 2));
    } catch (cause) {
      console.warn("[preferences] could not save:", cause);
    }
  }
};
/**
 * Coerces stored JSON into a valid shape.
 *
 * Preferences outlive the code that wrote them: a mode that no longer exists,
 * or a hand-edited file, must not put the panel into a state it cannot render.
 */
function sanitise(value) {
  return {
    mode: SCREEN_MODES.includes(value.mode) ? value.mode : DEFAULT_PREFERENCES.mode,
    cameraId: typeof value.cameraId === "string" ? value.cameraId : null,
    cameraLabel: typeof value.cameraLabel === "string" ? value.cameraLabel : null,
    micId: typeof value.micId === "string" ? value.micId : null,
    micLabel: typeof value.micLabel === "string" ? value.micLabel : null,
    systemAudio: value.systemAudio ?? DEFAULT_PREFERENCES.systemAudio,
    showCursor: value.showCursor ?? DEFAULT_PREFERENCES.showCursor,
    cameraPosition: point(value.cameraPosition),
  };
}
/** A stored point, or null if it is not one. Hand-edited files reach this. */
function point(value) {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value;
  return Number.isFinite(x) && Number.isFinite(y)
    ? {
        x,
        y,
      }
    : null;
}
function defaultFile() {
  return join(app.getPath("userData"), "preferences.json");
}
//#endregion
//#region src/main/tray.ts
/**
 * The menu-bar presence: icon, click-to-open panel, and right-click menu.
 */
/** How many past recordings the Open Recent submenu offers. */
var RECENT_LIMIT = 10;
function icon(name) {
  const path = fileURLToPath(new URL(`../../resources/${name}.png`, import.meta.url));
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) console.error(`tray icon is empty — nothing will be clickable: ${path}`);
  image.setTemplateImage(true);
  return image;
}
var AppTray = class {
  session;
  flow;
  tray;
  idle = icon("idleTemplate");
  recording = icon("recordingTemplate");
  constructor(session, flow) {
    this.session = session;
    this.flow = flow;
    this.tray = new Tray(this.idle);
    this.tray.setToolTip("Prequel");
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.on("click", () => this.flow.toggle());
    this.tray.on("right-click", () => this.tray.popUpContextMenu(this.contextMenu()));
    this.session.subscribe((state) => this.render(state));
    log("info", "tray ready");
  }
  /**
   * Re-renders from the current session state.
   *
   * The tray subscribes to the session, but the session only emits on state
   * *transitions* — start, pause, stop. Elapsed time is not a transition, so
   * without something pushing this on a beat the menu-bar clock sits frozen at
   * the value it had when recording began.
   */
  refresh() {
    this.render(this.session.snapshot());
  }
  destroy() {
    this.tray.destroy();
  }
  render(state) {
    const active = state.status === "recording" || state.status === "paused";
    this.tray.setImage(active ? this.recording : this.idle);
    this.tray.setTitle(active ? formatElapsed(state.elapsedMs) : "");
    this.tray.setToolTip(active ? `Prequel — ${state.status}` : "Prequel");
  }
  contextMenu() {
    const state = this.session.snapshot();
    const active = state.status === "recording" || state.status === "paused";
    const recent = recentRecordings(RECENT_LIMIT);
    return Menu.buildFromTemplate([
      active
        ? {
            label: "Stop Recording",
            accelerator: "Shift+Cmd+R",
            click: () => void this.flow.stop(),
          }
        : {
            label: "Start Recording…",
            accelerator: "Shift+Cmd+R",
            click: () => this.flow.open(),
          },
      {
        label: state.status === "paused" ? "Resume" : "Pause",
        enabled: active,
        click: () => void this.session.togglePause(),
      },
      { type: "separator" },
      {
        label: "Open Recent",
        enabled: recent.length > 0,
        submenu: recent.map((recording) => ({
          label: recording.name,
          click: () => this.flow.openEditor(recording.dir),
        })),
      },
      {
        label: "Show Recordings in Finder",
        click: () => void revealRecordings(),
      },
      {
        label: "Show Log in Finder",
        click: () => shell.showItemInFolder(logPath()),
      },
      { type: "separator" },
      {
        label: "Quit Prequel",
        accelerator: "Cmd+Q",
        click: () => {
          log("info", "quit requested from the tray");
          app.quit();
        },
      },
    ]);
  }
};
/** `m:ss`, or `h:mm:ss` once it runs past an hour. */
function formatElapsed(ms) {
  const total = Math.floor(ms / 1e3);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
//#endregion
//#region src/main/windows/camera.ts
/**
 * The floating camera bubble.
 *
 * Deliberately a preview only. The camera is recorded as its own track rather
 * than composited into the screen capture, which is what lets it be moved,
 * resized and reshaped after the recording — and it also means this window
 * never needs to appear in the capture at all.
 */
/** Diameter of the visible circle. The window adds `PANEL_INSET` all round. */
var SIZES$1 = {
  small: 160,
  medium: 220,
  large: 300,
};
/** Distance from the corner of the work area to the circle. */
var MARGIN = 32;
/** Window edge for a bubble size: the circle plus its shadow margin. */
function windowEdge(size) {
  return SIZES$1[size] + 36;
}
/**
 * How much of the bubble has to be on a display for a stored position to be
 * reused.
 *
 * A position saved on a monitor that has since been unplugged would otherwise
 * restore the bubble somewhere unreachable, with no way to drag it back.
 */
var MIN_VISIBLE = 60;
var CameraWindow = class {
  window = null;
  size = "medium";
  /** Centre of the circle, as last left by the user. */
  position = null;
  listener = null;
  /**
   * Restores a remembered position.
   *
   * The centre rather than a corner, because resizing the bubble grows it from
   * the middle — a stored corner would drift every time the size changed.
   */
  restore(position) {
    this.position = position;
  }
  /** Reports where the user left the bubble, so it can be remembered. */
  onMove(listener) {
    this.listener = listener;
  }
  /** Creates the window without showing it, so its id exists to be excluded. */
  prepare() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const edge = windowEdge(this.size);
    const window = createPanel({
      width: edge,
      height: edge,
      movable: true,
    });
    window.on("moved", () => {
      const bounds = window.getBounds();
      this.position = {
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      };
      this.listener?.(this.position);
    });
    window.setAlwaysOnTop(true, "floating");
    loadRoute(window, "/camera");
    this.window = window;
    return window;
  }
  show() {
    const window = this.prepare();
    if (!window.isVisible()) window.setBounds(this.openingBounds());
    window.showInactive();
  }
  hide() {
    this.window?.hide();
  }
  setSize(size) {
    if (this.size === size) return;
    this.size = size;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const current = window.getBounds();
    const edge = windowEdge(size);
    window.setBounds({
      x: Math.round(current.x + (current.width - edge) / 2),
      y: Math.round(current.y + (current.height - edge) / 2),
      width: edge,
      height: edge,
    });
  }
  browserWindow() {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }
  destroy() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
  /** Where the user left it, or the default corner if that is no longer sane. */
  openingBounds() {
    const remembered = this.position && this.boundsAround(this.position);
    return remembered && onScreen(remembered) ? remembered : this.defaultBounds();
  }
  /** The window that puts the circle's centre at `centre`. */
  boundsAround(centre) {
    const edge = windowEdge(this.size);
    return {
      x: Math.round(centre.x - edge / 2),
      y: Math.round(centre.y - edge / 2),
      width: edge,
      height: edge,
    };
  }
  /** Bottom-left of the display holding the cursor, clear of the panel. */
  defaultBounds() {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const edge = windowEdge(this.size);
    return {
      x: Math.round(workArea.x + MARGIN - 18),
      y: Math.round(workArea.y + workArea.height - edge - MARGIN + 18),
      width: edge,
      height: edge,
    };
  }
};
/** Whether enough of a window falls on some display to be usable. */
function onScreen(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);
    return overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE;
  });
}
//#endregion
//#region src/main/windows/dock.ts
/**
 * The bottom panel: setup before recording, controls during.
 *
 * One window that resizes rather than two that swap, so pressing Record reads
 * as the panel collapsing into the recording view — and so the window id stays
 * stable, which matters because that id is what keeps the panel out of the
 * recording.
 */
/**
 * The size of the visible panel. The window is larger — see `windowSize`.
 *
 * Setup's width is only a starting point: the panel's real width depends on
 * the device names in it, which main has no way to measure, so the renderer
 * reports it and `setContentWidth` takes over.
 */
var SIZES = {
  setup: {
    width: 420,
    height: 44,
  },
  recording: {
    width: 196,
    height: 44,
  },
};
/**
 * Bounds on a reported width.
 *
 * A measurement taken mid-layout can be nonsense, and a window sized from it
 * would be a full-screen transparent sheet or a sliver — neither of which the
 * user could recover from without quitting.
 */
var MIN_SETUP_WIDTH = 260;
var MAX_SETUP_WIDTH = 900;
/** Distance from the bottom of the work area to the bottom of the panel. */
var BOTTOM_MARGIN = 72;
/**
 * How long the panel takes to collapse into the recording controls.
 *
 * Driven here rather than through `setBounds`'s `animate` flag, which AppKit
 * ignores for a transparent non-activating panel — measured, not assumed: the
 * width jumped from 411 to 232 between two consecutive frames with it on.
 */
var COLLAPSE_MS = 220;
/**
 * A width change is a smaller move than the collapse and reads as fussy if it
 * takes as long, so it gets its own, quicker easing.
 */
var RESIZE_MS = 150;
var FRAME_MS = 16;
var DockWindow = class {
  window = null;
  view = "setup";
  menuOpen = false;
  animation = null;
  /** The setup panel's measured width, once the renderer has reported one. */
  contentWidth = null;
  /** Creates the window without showing it, so its id exists to be excluded. */
  prepare() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = createPanel({
      ...this.windowSize(),
      movable: true,
    });
    window.setAlwaysOnTop(true, "screen-saver", 1);
    loadRoute(window, "/dock");
    this.window = window;
    return window;
  }
  show() {
    const window = this.prepare();
    if (!window.isVisible()) this.applyBounds(window);
    window.showInactive();
  }
  hide() {
    this.menuOpen = false;
    this.stopAnimation();
    this.window?.hide();
  }
  toggle() {
    if (this.window?.isVisible()) this.hide();
    else this.show();
  }
  get isVisible() {
    return this.window?.isVisible() ?? false;
  }
  /** Resizes the panel between its setup and recording shapes. */
  setView(view) {
    if (this.view === view) return;
    this.view = view;
    this.menuOpen = false;
    this.reposition({ animate: true });
  }
  /**
   * Matches the window to the width the panel says it needs.
   *
   * Device names are the reason: sizing for the longest possible one leaves a
   * gap after every short one, and sizing for a short one clips the rest.
   */
  setContentWidth(width) {
    const clamped = Math.round(Math.min(Math.max(width, MIN_SETUP_WIDTH), MAX_SETUP_WIDTH));
    if (this.contentWidth === clamped) return;
    const measured = this.contentWidth !== null;
    this.contentWidth = clamped;
    if (this.view === "setup")
      this.reposition({
        animate: measured,
        duration: RESIZE_MS,
      });
  }
  /**
   * Grows the window upward so an open drop-up has somewhere to be drawn.
   *
   * Without this the menu is clipped to whatever fits inside the panel's own
   * height, which is a few pixels of its bottom edge.
   */
  setMenuOpen(open) {
    if (this.menuOpen === open) return;
    this.menuOpen = open;
    this.reposition();
  }
  browserWindow() {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }
  destroy() {
    this.stopAnimation();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
  /**
   * Eases the window to `target`.
   *
   * The panel *is* the window, so animating its width means animating the
   * frame — there is no CSS route to this without leaving the window at its
   * larger size and a transparent dead area around the collapsed panel.
   */
  animateTo(window, target, duration) {
    this.stopAnimation();
    const from = window.getBounds();
    const started = Date.now();
    this.animation = setInterval(() => {
      if (window.isDestroyed()) return this.stopAnimation();
      const t = Math.min(1, (Date.now() - started) / duration);
      const eased = 1 - (1 - t) ** 3;
      const at = (start, end) => Math.round(start + (end - start) * eased);
      window.setBounds({
        x: at(from.x, target.x),
        y: at(from.y, target.y),
        width: at(from.width, target.width),
        height: at(from.height, target.height),
      });
      if (t >= 1) this.stopAnimation();
    }, FRAME_MS);
  }
  stopAnimation() {
    if (!this.animation) return;
    clearInterval(this.animation);
    this.animation = null;
  }
  /**
   * The window is the panel plus a transparent margin on every side, which is
   * where its CSS drop shadow lands — macOS would otherwise draw a rectangular
   * shadow around a rounded panel — plus headroom for an open drop-up.
   */
  windowSize() {
    const { width, height } = SIZES[this.view];
    return {
      width: (this.view === "setup" ? (this.contentWidth ?? width) : width) + 36,
      height: height + 36 + (this.menuOpen ? 200 : 0),
    };
  }
  reposition(options = {}) {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    this.applyBounds(window, {
      keepPlace: true,
      ...options,
    });
  }
  /**
   * Positions the panel, holding it in place when the window changes shape so
   * it does not appear to jump across the screen.
   */
  applyBounds(window, options = {}) {
    const size = this.windowSize();
    if (options.keepPlace && window.isVisible()) {
      const current = window.getBounds();
      const target = {
        x: Math.round(current.x + (current.width - size.width) / 2),
        y: Math.round(current.y + current.height - size.height),
        ...size,
      };
      if (options.animate) this.animateTo(window, target, options.duration ?? COLLAPSE_MS);
      else {
        this.stopAnimation();
        window.setBounds(target);
      }
      return;
    }
    this.stopAnimation();
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    window.setBounds({
      x: Math.round(workArea.x + (workArea.width - size.width) / 2),
      y: Math.round(workArea.y + workArea.height - size.height - BOTTOM_MARGIN + 18),
      ...size,
    });
  }
};
//#endregion
//#region src/main/editor-session.ts
/**
 * Everything the editor window needs to open a recording.
 *
 * Assembled in main because two of the three pieces cannot come from anywhere
 * else: the manifest is read off disk, and the media URLs are built here so the
 * renderer never has to know — or be trusted with — a filesystem path.
 */
/**
 * Reads one recording into the payload its editor window needs.
 *
 * The probe is best-effort. A recording is still editable without the media's
 * own account of itself — the manifest already describes every track — so a
 * probe failure degrades the editor rather than refusing to open it.
 */
async function readEditorSession(dir) {
  const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
  let probes = [];
  try {
    probes = await (await getRecorder()).probeSession(dir);
  } catch (cause) {
    console.warn(`[editor] could not probe ${dir}:`, cause);
  }
  const byKind = new Map(probes.map((probe) => [probe.kind, probe]));
  const media = manifest.tracks.map((track) => {
    const probe = byKind.get(track.kind);
    return {
      kind: track.kind,
      url: mediaUrl(dir, track.file_name),
      offset: track.start,
      duration: probe?.duration ?? track.end - track.start,
      width: probe?.width ?? track.width ?? null,
      height: probe?.height ?? track.height ?? null,
      frameRate: probe?.frameRate ?? null,
    };
  });
  return {
    dir,
    name: basename(dir),
    manifest,
    media,
    project: await withBackground(dir, loadProject(dir, manifest.id, manifest.duration)),
  };
}
/**
 * Makes sure a project's wallpaper background actually has an image.
 *
 * A fresh project defaults to the desktop picture, which has to be copied into
 * the recording before it can be drawn. When that fails — no Screen Recording
 * grant, or a machine with nothing to capture — the background falls back to a
 * gradient rather than rendering as a placeholder that looks like a bug.
 *
 * Only the project defaults are repaired. A slice that overrides its background
 * was set deliberately, and quietly rewriting it would undo a decision.
 */
async function withBackground(dir, project) {
  const background = project.defaults.background.background;
  if (background.kind !== "image" || background.source !== "wallpaper") return project;
  if (await ensureWallpaper(dir)) return project;
  console.warn(`[editor] no wallpaper for ${dir}; falling back to a gradient`);
  return {
    ...project,
    defaults: {
      ...project.defaults,
      background: {
        ...project.defaults.background,
        background: FALLBACK_BACKGROUND,
      },
    },
  };
}
//#endregion
//#region src/main/windows/editor.ts
/**
 * Editor windows, one per recording.
 *
 * Keyed by directory rather than counted, because the same recording can be
 * reached from two places — stopping a take, and Open Recent — and opening a
 * second window onto one set of files would mean two editors writing the same
 * `project.json`.
 */
var MIN_WIDTH = 960;
var MIN_HEIGHT = 640;
var DEFAULT_WIDTH = 1280;
var DEFAULT_HEIGHT = 820;
var EditorWindows = class {
  options;
  windows = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.options = options;
  }
  get openCount() {
    return this.windows.size;
  }
  /**
   * Opens a recording, or focuses the window already showing it.
   *
   * The manifest is read before anything is created: a directory with no
   * readable `session.json` is not editable, and an empty window that says so
   * would be worse than the error the caller can report. The full session —
   * which also probes the media — is loaded afterwards, so the window can be up
   * and drawing while that happens.
   */
  open(dir) {
    const existing = this.windows.get(dir);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return existing;
    }
    const name = readManifestName(dir);
    const first = this.windows.size === 0;
    const window = createWindow({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: name,
      backgroundColor: "#16171a",
    });
    this.windows.set(dir, window);
    window.webContents.on("did-finish-load", () => {
      readEditorSession(dir)
        .then((session) => {
          if (window.isDestroyed()) return;
          window.webContents.send(IPC_CHANNELS.editorOpen, session);
        })
        .catch((cause) => {
          console.warn(`[editor] could not load ${dir}:`, cause);
        });
    });
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });
    window.on("closed", () => {
      this.windows.delete(dir);
      flushProject(dir);
      if (this.windows.size === 0) this.options.onLastClose?.();
    });
    loadRoute(window, "/editor");
    if (first) this.options.onFirstOpen?.();
    return window;
  }
  closeAll() {
    for (const window of [...this.windows.values()]) if (!window.isDestroyed()) window.destroy();
    this.windows.clear();
  }
};
/**
 * Checks a directory is an openable recording, and names it.
 *
 * Deliberately cheap and synchronous: it runs before the window exists so that
 * an unopenable directory throws at the call site rather than producing a
 * window with nothing in it.
 */
function readManifestName(dir) {
  parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
  return basename(dir);
}
//#endregion
//#region src/main/index.ts
app.setName("Prequel");
initLogging();
validateEnv();
/** Start/stop from anywhere, including while another app has focus. */
var TOGGLE_SHORTCUT = "Shift+Cmd+R";
var PAUSE_SHORTCUT = "Shift+Cmd+P";
if (!app.requestSingleInstanceLock()) app.quit();
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME_PRIVILEGES]);
var session = new RecordingSession();
var dock = new DockWindow();
var camera = new CameraWindow();
var selection = new SelectionOverlay();
var tray = null;
var flow = null;
var editors = new EditorWindows({
  onFirstOpen: () => {
    flow?.editorOpened();
    app.dock?.show();
  },
  onLastClose: () => {
    flow?.editorClosed();
    app.dock?.hide();
  },
});
if (!app.isPackaged) app.dock?.hide();
app.on("second-instance", () => flow?.open());
app.whenReady().then(() => {
  registerMediaProtocol();
  flow = new CaptureFlow({
    session,
    dock,
    camera,
    selection,
    preferences: new Preferences(),
    onChange: broadcastDockState,
    editors,
  });
  registerIpc({ flow });
  tray = new AppTray(session, flow);
  flow.open();
  const ticker = setInterval(() => {
    if (!session.isBusy()) return;
    broadcastDockState(flow.state());
    tray?.refresh();
  }, 1e3);
  app.on("will-quit", () => clearInterval(ticker));
  globalShortcut.register(TOGGLE_SHORTCUT, () => void flow?.toggleRecording());
  globalShortcut.register(PAUSE_SHORTCUT, () => void flow?.togglePause());
});
/**
 * Teardown, step by step.
 *
 * Each step is isolated: an exception thrown out of `will-quit` aborts the
 * quit, which strands the app running with no way out — exactly the failure
 * this logging exists to catch. Whatever goes wrong here, the app still exits,
 * and the log says what it was.
 */
app.on("will-quit", () => {
  log("info", "will-quit: tearing down");
  for (const [name, teardown] of [
    ["shortcuts", () => globalShortcut.unregisterAll()],
    ["selection", () => selection.close()],
    ["camera", () => camera.destroy()],
    ["dock", () => dock.destroy()],
    ["editors", () => editors.closeAll()],
    ["tray", () => tray?.destroy()],
  ])
    try {
      teardown();
    } catch (cause) {
      log("error", `will-quit: ${name} teardown failed`, cause);
    }
  log("info", "will-quit: done");
});
app.on("before-quit", () => log("info", "before-quit"));
app.on("quit", (_event, code) => log("info", `quit with code ${code}`));
app.on("window-all-closed", () => log("info", "window-all-closed (staying alive)"));
/**
 * Quits on a terminate signal.
 *
 * Electron installs no handler, so `kill` on a menu-bar app does nothing and
 * the only way out is `kill -9` — which skips teardown entirely and leaves a
 * half-written project behind.
 */
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    log("info", `${signal} received, quitting`);
    app.quit();
  });
//#endregion
export { TRACK_FILE_NAMES as n, MANIFEST_FILE_NAME as t };
