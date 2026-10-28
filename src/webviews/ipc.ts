'use strict';
import { Logger } from '../logger';
import { IpcCommandParamsOf, IpcCommandType, IpcMessage } from './protocol';

export async function onIpcCommand<CT extends IpcCommandType>(
	type: CT,
	command: IpcMessage,
	fn: (params: IpcCommandParamsOf<CT>) => unknown,
): Promise<void> {
	try {
		await fn(command.params);
	} catch (ex) {
		Logger.error(ex, `onIpcCommand(${type.method})`);
	}
}
