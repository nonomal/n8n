import { NodeConnectionType, NodeOperationError, jsonStringify } from 'n8n-workflow';
import type { EventNamesAiNodesType, IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { BaseChatModel } from 'langchain/chat_models/base';
import { BaseChatModel as BaseChatModelCore } from '@langchain/core/language_models/chat_models';
import type { BaseOutputParser } from '@langchain/core/output_parsers';
import type { BaseMessage } from 'langchain/schema';
import { DynamicTool, type Tool } from 'langchain/tools';

export function getMetadataFiltersValues(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Record<string, never> | undefined {
	const metadata = ctx.getNodeParameter('options.metadata.metadataValues', itemIndex, []) as Array<{
		name: string;
		value: string;
	}>;
	if (metadata.length > 0) {
		return metadata.reduce((acc, { name, value }) => ({ ...acc, [name]: value }), {});
	}

	return undefined;
}

// TODO: Remove this function once langchain package is updated to 0.1.x
// eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
export function isChatInstance(model: any): model is BaseChatModel | BaseChatModelCore {
	return model instanceof BaseChatModel || model instanceof BaseChatModelCore;
}

export async function getOptionalOutputParsers(
	ctx: IExecuteFunctions,
): Promise<Array<BaseOutputParser<unknown>>> {
	let outputParsers: BaseOutputParser[] = [];

	if (ctx.getNodeParameter('hasOutputParser', 0, true) === true) {
		outputParsers = (await ctx.getInputConnectionData(
			NodeConnectionType.AiOutputParser,
			0,
		)) as BaseOutputParser[];
	}

	return outputParsers;
}

export function getPromptInputByType(options: {
	ctx: IExecuteFunctions;
	i: number;
	promptTypeKey: string;
	inputKey: string;
}) {
	const { ctx, i, promptTypeKey, inputKey } = options;
	const prompt = ctx.getNodeParameter(promptTypeKey, i) as string;

	let input;
	if (prompt === 'auto') {
		input = ctx.evaluateExpression('{{ $json["chatInput"] }}', i) as string;
	} else {
		input = ctx.getNodeParameter(inputKey, i) as string;
	}

	if (input === undefined) {
		throw new NodeOperationError(ctx.getNode(), 'No prompt specified', {
			description:
				"Expected to find the prompt in an input field called 'chatInput' (this is what the chat trigger node outputs). To use something else, change the 'Prompt' parameter",
		});
	}

	return input;
}

export function getSessionId(
	ctx: IExecuteFunctions,
	itemIndex: number,
	selectorKey = 'sessionIdType',
	autoSelect = 'fromInput',
	customKey = 'sessionKey',
) {
	let sessionId = '';
	const selectorType = ctx.getNodeParameter(selectorKey, itemIndex) as string;

	if (selectorType === autoSelect) {
		sessionId = ctx.evaluateExpression('{{ $json.sessionId }}', itemIndex) as string;
		if (sessionId === '' || sessionId === undefined) {
			throw new NodeOperationError(ctx.getNode(), 'No session ID found', {
				description:
					"Expected to find the session ID in an input field called 'sessionId' (this is what the chat trigger node outputs). To use something else, change the 'Session ID' parameter",
				itemIndex,
			});
		}
	} else {
		sessionId = ctx.getNodeParameter(customKey, itemIndex, '') as string;
		if (sessionId === '' || sessionId === undefined) {
			throw new NodeOperationError(ctx.getNode(), 'Key parameter is empty', {
				description:
					"Provide a key to use as session ID in the 'Key' parameter or use the 'Take from previous node automatically' option to use the session ID from the previous node, e.t. chat trigger node",
				itemIndex,
			});
		}
	}

	return sessionId;
}

export async function logAiEvent(
	executeFunctions: IExecuteFunctions,
	event: EventNamesAiNodesType,
	data?: IDataObject,
) {
	try {
		await executeFunctions.logAiEvent(event, data ? jsonStringify(data) : undefined);
	} catch (error) {
		executeFunctions.logger.debug(`Error logging AI event: ${event}`);
	}
}

export function serializeChatHistory(chatHistory: BaseMessage[]): string {
	return chatHistory
		.map((chatMessage) => {
			if (chatMessage._getType() === 'human') {
				return `Human: ${chatMessage.content}`;
			} else if (chatMessage._getType() === 'ai') {
				return `Assistant: ${chatMessage.content}`;
			} else {
				return `${chatMessage.content}`;
			}
		})
		.join('\n');
}

export const getConnectedTools = async (ctx: IExecuteFunctions, checkUniqueness: boolean) => {
	const tools = ((await ctx.getInputConnectionData(NodeConnectionType.AiTool, 0)) as Tool[]) || [];

	if (!checkUniqueness) return tools;

	const dynamicToolsNames = tools
		.filter((tool) => tool instanceof DynamicTool)
		.map((tool) => tool.name);

	if (dynamicToolsNames.length) {
		const uniqueDynamicToolsNames = Array.from(new Set(dynamicToolsNames));

		if (uniqueDynamicToolsNames.length < dynamicToolsNames.length) {
			for (const name of dynamicToolsNames) {
				if (dynamicToolsNames.filter((n) => n === name).length > 1) {
					throw new NodeOperationError(
						ctx.getNode(),
						`You have multiple tools with the same name: '${name}', please rename them to avoid conflicts`,
					);
				}
			}
		}
	}

	return tools;
};
