import { getInteractionCommandName } from '@muse/util/get-interaction-command-name';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Client, Events } from 'discord.js';
import { CommandsService, Context, ContextOf, On, Once } from 'necord';
import { Counter, Gauge } from 'prom-client';

@Injectable()
export class MetricsEvents {
	private readonly _logger = new Logger(MetricsEvents.name);

	constructor(
		private readonly _client: Client,
		private readonly _commands: CommandsService,
		@InjectMetric('discord_connected') public connected: Gauge<string>,
		@InjectMetric('discord_latency')
		public latency: Gauge<string>,
		@InjectMetric('discord_stat_total_guilds')
		public totalGuilds: Gauge<string>,
		@InjectMetric('discord_stat_total_channels')
		public totalChannels: Gauge<string>,
		@InjectMetric('discord_stat_total_users')
		public totalUsers: Gauge<string>,
		@InjectMetric('discord_stat_total_interactions')
		public totalInteractions: Gauge<string>,
		@InjectMetric('discord_event_on_interaction_total')
		public onInteractionTotal: Counter<string>,
	) {}

	@Cron('*/5 * * * * *')
	public latencyLoop() {
		if (!this._client) {
			return;
		}

		this.latency.labels('None').set(this._client.ws.ping);
	}

	@Once(Events.ClientReady)
	public onReady(@Context() [client]: ContextOf<Events.ClientReady>) {
		this._logger.log(`Initializing metrics`);

		this._reloadGauges(client);

		this.connected.labels('None').set(1);
	}

	@On(Events.InteractionCreate)
	public onInteractionCreate(
		@Context() [interaction]: ContextOf<Events.InteractionCreate>,
	) {
		const shardId = interaction.guild.shardId
			? interaction.guild.shardId.toString()
			: 'NONE';
		const commandName = getInteractionCommandName(interaction, '/');
		this.onInteractionTotal
			.labels(shardId, interaction.constructor.name, commandName)
			.inc();
	}

	@On(Events.ShardResume)
	public onShardResume(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		@Context() [_, shardId]: ContextOf<Events.ShardResume>,
	) {
		this.connected.labels(shardId ? shardId.toString() : 'NONE').set(1);
	}

	@On(Events.ShardReady)
	public onShardReady(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		@Context() [_, shardId]: ContextOf<Events.ShardReady>,
	) {
		this.connected.labels(shardId ? shardId.toString() : 'NONE').set(1);
	}

	@On(Events.ShardDisconnect)
	public onShardDisconnect(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		@Context() [_, shardId]: ContextOf<Events.ShardDisconnect>,
	) {
		this.connected.labels(shardId ? shardId.toString() : 'NONE').set(0);
	}

	@On(Events.GuildCreate)
	public onGuildCreate() {
		this._reloadGauges();
	}

	@On(Events.GuildDelete)
	public onGuildDelete() {
		this._reloadGauges();
	}

	@On(Events.ChannelCreate)
	public onChannelCreate() {
		this.totalChannels.inc();
	}

	@On(Events.ChannelDelete)
	public onChannelDelete() {
		this.totalChannels.dec();
	}

	@On(Events.GuildMemberAdd)
	public onGuildMemberAdd() {
		this.totalUsers.inc();
	}

	@On(Events.GuildMemberRemove)
	public onGuildMemberRemove() {
		this.totalUsers.dec();
	}

	private _getCommandsCount() {
		const commands = this._commands.getCommands();
		let totalCommands = 0;

		for (const command of commands) {
			totalCommands += 1;
			totalCommands += (command as any).subcommands?.size ?? 0;
		}

		return totalCommands;
	}

	private _reloadGauges(client = this._client) {
		this.totalGuilds.set(client.guilds.cache.size);
		this.totalChannels.set(client.channels.cache.size);
		this.totalUsers.set(client.users.cache.size);

		this.totalInteractions.set(this._getCommandsCount());
	}
}