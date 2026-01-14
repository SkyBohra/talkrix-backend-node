import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Dynamic Parameter Schema
@Schema({ _id: false })
export class DynamicParameter {
  @Prop({ required: true })
  name: string;

  @Prop()
  location: string; // PARAMETER_LOCATION_UNSPECIFIED, PARAMETER_LOCATION_QUERY, PARAMETER_LOCATION_PATH, PARAMETER_LOCATION_HEADER, PARAMETER_LOCATION_BODY

  @Prop({ type: Object })
  schema: Record<string, any>;

  @Prop()
  required: boolean;
}

export const DynamicParameterSchema = SchemaFactory.createForClass(DynamicParameter);

// Static Parameter Schema
@Schema({ _id: false })
export class StaticParameter {
  @Prop({ required: true })
  name: string;

  @Prop()
  location: string;

  @Prop({ type: Object })
  value: any;
}

export const StaticParameterSchema = SchemaFactory.createForClass(StaticParameter);

// Automatic Parameter Schema
@Schema({ _id: false })
export class AutomaticParameter {
  @Prop({ required: true })
  name: string;

  @Prop()
  location: string;

  @Prop()
  knownValue: string; // KNOWN_PARAM_UNSPECIFIED, KNOWN_PARAM_CALL_ID, KNOWN_PARAM_CONVERSATION_HISTORY
}

export const AutomaticParameterSchema = SchemaFactory.createForClass(AutomaticParameter);

// HTTP Security Options Schema
@Schema({ _id: false })
export class HttpSecurityOption {
  @Prop({ type: Object })
  requirements: Record<string, any>;

  @Prop({ type: Object })
  ultravoxCallTokenRequirement: {
    scopes: string[];
  };
}

export const HttpSecurityOptionSchema = SchemaFactory.createForClass(HttpSecurityOption);

@Schema({ _id: false })
export class HttpSecurityOptions {
  @Prop({ type: [HttpSecurityOptionSchema] })
  options: HttpSecurityOption[];
}

export const HttpSecurityOptionsSchema = SchemaFactory.createForClass(HttpSecurityOptions);

// Tool Requirements Schema
@Schema({ _id: false })
export class ToolRequirements {
  @Prop({ type: HttpSecurityOptionsSchema })
  httpSecurityOptions: HttpSecurityOptions;

  @Prop({ type: [String] })
  requiredParameterOverrides: string[];
}

export const ToolRequirementsSchema = SchemaFactory.createForClass(ToolRequirements);

// HTTP Tool Implementation Schema
@Schema({ _id: false })
export class HttpToolImplementation {
  @Prop()
  baseUrlPattern: string;

  @Prop()
  httpMethod: string;
}

export const HttpToolImplementationSchema = SchemaFactory.createForClass(HttpToolImplementation);

// Static Response Schema
@Schema({ _id: false })
export class StaticResponse {
  @Prop()
  responseText: string;
}

export const StaticResponseSchema = SchemaFactory.createForClass(StaticResponse);

// Tool Definition Schema
@Schema({ _id: false })
export class ToolDefinition {
  @Prop()
  modelToolName: string;

  @Prop()
  description: string;

  @Prop({ type: [DynamicParameterSchema] })
  dynamicParameters: DynamicParameter[];

  @Prop({ type: [StaticParameterSchema] })
  staticParameters: StaticParameter[];

  @Prop({ type: [AutomaticParameterSchema] })
  automaticParameters: AutomaticParameter[];

  @Prop({ type: ToolRequirementsSchema })
  requirements: ToolRequirements;

  @Prop()
  timeout: string;

  @Prop()
  precomputable: boolean;

  @Prop({ type: HttpToolImplementationSchema })
  http: HttpToolImplementation;

  @Prop({ type: Object })
  client: Record<string, any>;

  @Prop({ type: Object })
  dataConnection: Record<string, any>;

  @Prop()
  defaultReaction: string; // AGENT_REACTION_UNSPECIFIED, AGENT_REACTION_SPEAK, AGENT_REACTION_SILENT

  @Prop({ type: StaticResponseSchema })
  staticResponse: StaticResponse;
}

export const ToolDefinitionSchema = SchemaFactory.createForClass(ToolDefinition);

// Main Tool Schema
@Schema({ timestamps: true })
export class Tool extends Document {
  @Prop({ required: true })
  talkrixToolId: string; // The toolId from Talkrix/Ultravox

  @Prop({ required: true })
  userId: string; // Owner of the tool

  @Prop({ required: true, maxlength: 40 })
  name: string;

  @Prop({ type: ToolDefinitionSchema, required: true })
  definition: ToolDefinition;

  @Prop()
  ownership: string; // 'public' or 'private'

  @Prop()
  talkrixCreated: Date; // When created in Talkrix
}

export const ToolSchema = SchemaFactory.createForClass(Tool);
