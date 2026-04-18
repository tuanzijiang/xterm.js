/**
 * Copyright (c) 2021 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { IBuffer as IBufferApi, IBufferCell as IBufferCellApi, IBufferJSONObj, IBufferLine as IBufferLineApi } from '@xterm/xterm';
import { IBuffer } from 'common/buffer/Types';
import { IBufferJSONObj as ICoreBufferJSONObj } from 'common/Types';
import { BufferLineApiView } from 'common/public/BufferLineApiView';
import { CellData } from 'common/buffer/CellData';

export class BufferApiView implements IBufferApi {
  constructor(
    private _buffer: IBuffer,
    public readonly type: 'normal' | 'alternate'
  ) { }

  public init(buffer: IBuffer): BufferApiView {
    this._buffer = buffer;
    return this;
  }

  public get cursorY(): number { return this._buffer.y; }
  public get cursorX(): number { return this._buffer.x; }
  public get viewportY(): number { return this._buffer.ydisp; }
  public get baseY(): number { return this._buffer.ybase; }
  public get length(): number { return this._buffer.lines.length; }
  public getLength(): number { return this._buffer.getLength(); }
  public getEffectiveLength(): number { return this._buffer.getEffectiveLength(); }
  public getLine(y: number): IBufferLineApi | undefined {
    const line = this._buffer.lines.get(y);
    if (!line) {
      return undefined;
    }
    return new BufferLineApiView(line);
  }
  public getCursorLine(): IBufferLineApi | undefined {
    const line = this._buffer.getCursorLine();
    if (!line) {
      return undefined;
    }
    return new BufferLineApiView(line);
  }
  public getViewportBottomLine(): IBufferLineApi | undefined {
    const line = this._buffer.getViewportBottomLine();
    if (!line) {
      return undefined;
    }
    return new BufferLineApiView(line);
  }
  public getNullCell(): IBufferCellApi { return new CellData(); }
  public fromJSON(data: IBufferJSONObj): IBufferApi {
    this._buffer.fromJSON(data as unknown as ICoreBufferJSONObj);
    return this;
  }
  public toJSON(): IBufferJSONObj {
    return this._buffer.toJSON() as unknown as IBufferJSONObj;
  }
}
