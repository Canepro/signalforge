/**
 * Minimal typings for sql.js (package ships JS only).
 * @see https://sql.js.org/documentation/
 */
declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface BindParams {
    [key: string]: string | number | bigint | Uint8Array | null;
  }

  export class Statement {
    bind(values?: unknown[] | BindParams | null): boolean;
    step(): boolean;
    getAsObject(params?: BindParams): Record<string, unknown>;
    free(): boolean;
    reset(): void;
  }

  export class Database {
    constructor(data?: number[] | Uint8Array | ArrayBuffer | Buffer | null);
    run(sql: string, params?: unknown[] | BindParams): Database;
    exec(sql: string, params?: unknown[] | BindParams): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}
