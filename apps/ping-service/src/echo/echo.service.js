"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EchoService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const node_crypto_1 = require("node:crypto");
const service_kit_1 = require("@nekoflix/service-kit");
const echo_schema_1 = require("./echo.schema");
let EchoService = class EchoService {
    model;
    outbox;
    constructor(model, outbox) {
        this.model = model;
        this.outbox = outbox;
    }
    /**
     * Ghi dữ liệu nghiệp vụ + phát event trong MỘT transaction.
     *
     * Đây là pattern được lặp lại ở mọi service. Viết sai ở đây thì sai ở
     * khắp nơi — nên walking skeleton tồn tại chính là để chứng minh nó đúng
     * trước khi có bất kỳ nghiệp vụ thật nào.
     */
    async create(input, createdBy) {
        const echoId = (0, node_crypto_1.randomUUID)();
        const createdAt = new Date();
        const result = await this.outbox.withTransaction(async (session) => {
            await this.model.create([{ echoId, message: input.message, createdBy }], { session });
            await this.outbox.publish('ping.echo.created', {
                echoId,
                message: input.message,
                createdBy,
                createdAt: createdAt.toISOString(),
            }, { session });
            // Cố ý ném lỗi SAU khi đã ghi cả hai. Dùng để chứng minh transaction
            // rollback CẢ dữ liệu lẫn outbox — không để lại event mồ côi.
            if (input.failAfterWrite) {
                throw service_kit_1.AppError.internal('Lỗi cố ý để kiểm tra rollback của outbox.');
            }
            return { echoId, message: input.message, createdAt: createdAt.toISOString() };
        });
        (0, service_kit_1.getLogger)().info({ echoId }, 'đã tạo echo và ghi outbox');
        return result;
    }
    async list() {
        const docs = await this.model.find().sort({ createdAt: -1 }).limit(50).lean();
        return {
            items: docs.map((d) => ({
                echoId: d.echoId,
                message: d.message,
                createdAt: new Date(d.createdAt).toISOString(),
            })),
        };
    }
};
exports.EchoService = EchoService;
exports.EchoService = EchoService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(echo_schema_1.Echo.name)),
    __metadata("design:paramtypes", [mongoose_2.Model,
        service_kit_1.OutboxService])
], EchoService);
//# sourceMappingURL=echo.service.js.map