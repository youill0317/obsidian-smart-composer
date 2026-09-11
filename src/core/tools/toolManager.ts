import { CLI_TOOL_NAME, CliExecution } from '../../types/cli.types'
import {
  ToolCallResponseStatus as Status,
  ToolCallRequest,
  ToolCallResponse,
} from '../../types/tool-call.types'
import { CliManager } from '../cli/cliManager'
import { McpManager } from '../mcp/mcpManager'

export class ToolManager {
  constructor(
    readonly cli: CliManager,
    private getMcp: () => Promise<McpManager>,
  ) {}

  async listAvailableTools() {
    const cliTools = this.cli.listAvailableTools()
    try {
      return [
        ...(await (await this.getMcp()).listAvailableTools()),
        ...cliTools,
      ]
    } catch (error) {
      if (!cliTools.length) throw error
      return cliTools
    }
  }

  async prepareCall(
    request: ToolCallRequest,
    conversationId: string,
  ): Promise<ToolCallResponse> {
    if (request.name === CLI_TOOL_NAME) {
      try {
        const execution = await this.cli.prepare(request.arguments)
        return {
          status: execution.automatic ? Status.Running : Status.PendingApproval,
          execution,
        }
      } catch (error) {
        return {
          status: Status.Error,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    const allowed = (await this.getMcp()).isToolExecutionAllowed({
      requestToolName: request.name,
      conversationId,
    })
    return { status: allowed ? Status.Running : Status.PendingApproval }
  }

  async callTool(params: {
    name: string
    args?: string
    id: string
    signal?: AbortSignal
    approved?: CliExecution
    conversationId?: string
  }): Promise<ToolCallResponse> {
    if (params.name === CLI_TOOL_NAME)
      return this.cli.execute(
        params.id,
        params.args,
        params.approved,
        params.signal,
        false,
        params.conversationId,
      )
    const mcp = await this.getMcp()
    if (params.signal?.aborted) return { status: Status.Aborted }
    return mcp.callTool(params)
  }

  async abortToolCall(id: string) {
    if (!this.cli.abortToolCall(id)) {
      try {
        ;(await this.getMcp()).abortToolCall(id)
      } catch {
        /* MCP may be unavailable. */
      }
    }
  }

  async allowToolForConversation(name: string, conversationId: string) {
    if (name !== CLI_TOOL_NAME)
      (await this.getMcp()).allowToolForConversation(name, conversationId)
  }
}
