"use strict";
// import init, { greet, add, fetch_wasm_map, fetch_wasm_json } from './rust-fetch/pkg/rust_fetch';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeWasm = initializeWasm;
const path = __importStar(require("path"));
const promises_1 = require("fs/promises");
const rust_fetch_1 = __importDefault(require("rust-fetch"));
const wasmPath = path.join(process.cwd(), 'node_modules', '@asemqaffaf/rust-fetch', 'rust-fetch', 'pkg', 'rust_fetch_bg.wasm');
let initialized = false;
let initPromise = null;
function initializeWasm() {
    return __awaiter(this, void 0, void 0, function* () {
        const wasmBuffer = yield (0, promises_1.readFile)(wasmPath);
        return yield (0, rust_fetch_1.default)(wasmBuffer);
    });
}
function ensureInitialized() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!initialized) {
            if (!initPromise) {
                initPromise = initializeWasm();
            }
            yield initPromise;
            initialized = true;
        }
    });
}
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield ensureInitialized();
}))();
exports.default = initializeWasm;
__exportStar(require("rust-fetch"), exports);
