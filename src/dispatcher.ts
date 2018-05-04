import { CommandClient } from "./client";
import { Message } from "discord.js";
import { CommandManager } from "./command-manager";
import * as discord from "discord.js";
import { Context, Command } from "./command";

class InvalidArgumentException {
    constructor(public arg: string, public type: string) {
        this.arg = arg;
        this.type = type;
    }
}

/** Splits a string on spaces while preserving quoted text */
function parseCommand(cmd: string) {
    const splitRegex = /[^\s"]+|"([^"]*)"/gi;
    const result: string[] = [];

    let match: any;
    do {
        match = splitRegex.exec(cmd);

        if (match) {
            result.push(match[1] ? match[1] : match[0]);
        }
    } while (match != null);

    return result;
}

class InvalidTypeException {
    constructor(public expectedType: string, public provided: string) { }
}

/** Attempts to convert string values to specified type */
async function convertToType(client: CommandClient, item: string, type: any) {
    try {
        switch (type) {
            case Number:
                const result = parseFloat(item);
                if (isNaN(result) && item !== "NaN") {
                    throw new InvalidArgumentException(item, "number");
                }

                return result;
            
            case discord.User:
                // if mention, message will be <@id>
                if (item.startsWith("<")) {
                    item = item.substring(2, item.length - 1);
                }

                return client.fetchUser(item);

            case Object:
            case String:
                return item;
            
            default:
                // if nothing else, try calling the constructor with the string
                // TODO: this could cause an exception
                return new type(item);
        }
    } catch (ex) {
        if (type.name) {
            throw new InvalidTypeException(type.name, item);
        } else {
            throw new InvalidTypeException(type.toString(), item);
        }
    }
}

class TooFewArgumentsException { }

export class CommandDispatcher {
    constructor(private commandManager: CommandManager) { }

    async handleMessage(client: CommandClient, msg: Message) {
        if (!msg.content.startsWith(client.options.commandPrefix)) { return; }
        let content = msg.content.substring(client.options.commandPrefix.length);

        const parts = parseCommand(content);
        const commandName = parts[0];

        const rootCommand = this.commandManager.getRootCommand(commandName);
        if (rootCommand === undefined) {
            if (client.options.unknownCommandResponse) {
                msg.reply(`unknown command '${commandName}'`);
            }

            return;
        }

        let argIdx = 1;
        if (rootCommand instanceof Command) {
            let params = rootCommand.params;

            // only want to convert parameters up to the @rest param
            // which is only allowed to be of type string
            let restIndex = rootCommand.params.findIndex(p => p.rest);
            if (restIndex !== -1) {
                params = params.slice(0, restIndex);
            }

            let typedArgs = await Promise.all(params.map(async param => {
                if (param.type === Context) {
                    return new Context(msg.channel as discord.TextChannel, msg, msg.author);
                }

                // if we're out of text, and this is optional - return nothing
                if (argIdx >= parts.length) {
                    if (param.optional) { return undefined; }
                    throw new TooFewArgumentsException();
                }

                return await convertToType(client, parts[argIdx++], param.type)
            })).catch((err: TooFewArgumentsException | InvalidTypeException) => {
                return err;
            });

            if (typedArgs instanceof InvalidTypeException) {
                msg.channel.send(`Invalid argument '${typedArgs.provided}', expected argument of type '${typedArgs.expectedType}'`);
                return;
            } else if (typedArgs instanceof TooFewArgumentsException) {
                let expectedNumArgs = params.length - params.filter(p => p.optional).length;
                msg.channel.send(`Expected ${expectedNumArgs} argument(s), but got ${parts.length} argument(s)`);
                return;
            }

            if (restIndex !== -1) {
                typedArgs = typedArgs.concat(parts.slice(restIndex).join(" "));
            }

            rootCommand.method.call(rootCommand.gear, ...typedArgs as any[]);
        } else {
            // TODO: handle command groups
        }
    }
}