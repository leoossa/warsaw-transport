import * as L from "leaflet";
import * as Voronoi from "voronoi";
import {Point, Points, Routes, ShapeData} from "./types";
import {DijkstraAlgorithm} from "./dijkstra";

export class ShapeMap {

    private shape: ShapeData;
    private points: Points;
    private visiblePoints: Point[];

    private map: L.Map;
    private layer: L.TileLayer;
    private overlay: L.ImageOverlay;
    private canvas: HTMLCanvasElement;
    private center: L.LatLngTuple;

    constructor(shape: ShapeData, points: Points) {
        this.shape = shape;
        this.points = points;
        this.visiblePoints = this.createVisiblePoints();
        this.canvas = document.createElement("canvas");
        this.canvas.width = this.shape.size[0];
        this.canvas.height = this.shape.size[1];
        this.initMap(shape);
    }

    private pixelPosition(lat: number, lon: number): Site {
        const min: L.LatLngTuple = this.shape.box[0];
        const max: L.LatLngTuple = this.shape.box[1];
        let x = Math.round(((lon - min[1]) / (max[1] - min[1])) * this.shape.size[0]);
        let y = Math.round(((max[0] - lat) / (max[0] - min[0])) * this.shape.size[1]);
        return {x: x, y: y}
    }

    private createVisiblePoints(): Point[] {
        let res: Point[] = [];
        const min: L.LatLngTuple = this.shape.box[0];
        const max: L.LatLngTuple = this.shape.box[1];
        for(let key of Object.keys(this.points)) {
            const point: Point = this.points[key];
            if(point.lat > max[0] || point.lat < min[0] || point.lon > max[1] || point.lon < min[1]) {
                continue;
            }
            let pos: Site = this.pixelPosition(point.lat, point.lon);
            point.x = pos.x;
            point.y = pos.y;
            point.colorHex = this.randomColor();
            res.push(point);
        }
        return res;
    }

    private initMap(shape: ShapeData) {
        this.map = new L.Map("mapid");
        this.map.setView(shape.center, 11);

        const attribution = `&copy; <a href="http://openstreetmap.org">OpenStreetMap</a>`;
        this.layer = L.tileLayer("http://{s}.tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png", {attribution, maxZoom: 18,});
        this.layer.addTo(this.map);

        this.overlay = L.imageOverlay(this.draw(), shape.box, {opacity: 0.5, interactive: true});
        this.overlay.addTo(this.map);

        this.map.on("click", (event: any) => this.onClick(event));
    }

    private onClick(event: any): void {
        let loc: L.LatLngLiteral = event.latlng;
        const min: L.LatLngTuple = this.shape.box[0];
        const max: L.LatLngTuple = this.shape.box[1];
        const pos: Site = this.pixelPosition(loc.lat, loc.lng);
        if(pos.y < 0 || pos.y >= this.shape.hborder.length || pos.x < 0 || pos.x > this.shape.vborder.length) {
            return;
        }
        if(!this.isOutsideShape(pos.x, pos.y)) {
            const timeStart :number = performance.now();
            this.repaint(17, "week", [loc.lat, loc.lng]);
            console.log(`repaint in ${(performance.now() - timeStart) / 1000}s`);
        }
    }

    private repaint(hour: number, day: string, center: L.LatLngTuple): void {
        this.center = center;
        let routes: Routes = require(`./includes/routes_week_17.json`);
        let start: number = hour * 60;
        let end: number = start + 120;
        let dijkstra: DijkstraAlgorithm = new DijkstraAlgorithm(this.points, routes, hour * 60);
        dijkstra.execute(center);

        const color1: number[] = [244, 234, 198];
        const color2: number[] = [136, 0, 21];
        for(let point of this.visiblePoints) {
            const weight = Math.min((point.cost - start) / (end - start), 1.0);
            point.color = this.gradientValue(color1, color2, weight);
            point.colorHex = this.rgbToHex(point.color);
        }

        this.overlay.setUrl(this.draw());
    }

    private gradientValue(color1: number[], color2: number[], weight: number): number[] {
        const res: number[] = [];
        for(let idx=0; idx<4; ++idx) {
            res.push(color1[idx] * Math.abs(weight - 1.0) + color2[idx] * weight);
        }
        return res;
    }

    private rgbToHex(color: number[]): string {
        let rgb = color[2] | (color[1] << 8) | (color[0] << 16);
        return "#" + (0x1000000 | rgb).toString(16).substring(1);
    }

    private draw(): string {
        this.drawVoronoiDiagram();
        this.drawBorders();
        this.drawCenter();
        return this.canvas.toDataURL("image/png");
    }

    private drawCenter(): void {
        if(!this.center) return;
        const loc: Site = this.pixelPosition(this.center[0], this.center[1]);
        let ctx: CanvasRenderingContext2D = this.canvas.getContext("2d");
        ctx.beginPath();
        ctx.arc(loc.x, loc.y, 10, 0, 2 * Math.PI, false);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#333333";
        ctx.stroke();
    }

    private drawBorders(): void {
        let ctx: CanvasRenderingContext2D = this.canvas.getContext("2d");
        let image: ImageData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        for(let i = 0; i < image.height; ++i) {
            for(let j = 0; j < image.width; ++j) {
                const idx = (i * image.width + j) * 4;
                if(this.isOutsideShape(j, i)) {
                    this.setPixel(image, idx, [0, 0, 0, 0]);
                }
            }
        }
        ctx.putImageData(image, 0, 0);
    }

    private isOutsideShape(x: number, y: number): boolean {
        const hb = this.shape.hborder[y];
        const vb = this.shape.vborder[x];
        return x < hb[0] || x > hb[1] || y < vb[0] || y > vb[1];
    }

    private setPixel(image: ImageData, idx: number, values: number[]): void {
        for(let i=0; i<4; ++i) {
            image.data[idx + i] = values[i];
        }
    }

    private drawVoronoiDiagram(): void {
        const bbox: BBox = {xl: 0, xr: this.shape.size[0] - 1, yt: 0, yb: this.shape.size[1]};
        const sites: Site[] = this.visiblePoints;
        const voronoi: Voronoi = new Voronoi();
        const diagram: VoronoiDiagram = voronoi.compute(sites, bbox);

        let ctx: CanvasRenderingContext2D = this.canvas.getContext("2d");
        for(let cell of diagram.cells) {
            this.drawVoronoiCell(cell, ctx);
        }
    }

    private drawVoronoiCell(cell: VoronoiCell, ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = (cell.site as Point).colorHex;
        ctx.beginPath();
        const halfedges: VoronoiHalfedge[] = cell.halfedges;
        if(halfedges.length === 0) return;

        let start: VoronoiVertex = halfedges[0].getStartpoint();
        let end: VoronoiVertex = halfedges[0].getEndpoint();
        ctx.moveTo(start.x, start.y);
        let currentX = start.x;
        let currentY = start.y;
        for(let i=0; i<halfedges.length; ++i) {
            let he: VoronoiHalfedge = halfedges[i];
            start = halfedges[i].getStartpoint();
            if(currentX !== start.x || currentY !== start.y) {
                console.log(`point mismatch: (${currentX}, ${currentY}) != (${start.x}, ${start.y})`);
            }
            end = halfedges[i].getEndpoint();
            currentX = end.x;
            currentY = end.y;
            ctx.lineTo(end.x, end.y);
        }
        ctx.closePath();
        ctx.fill();
    }

    private randomColor(): string {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++ ) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    private randomSites(num: number): Site[] {
        let res: Site[] = [];
        while(res.length < num) {
            const site = this.randomSite();
            if(!this.isOutsideShape(site.x, site.y)) {
                res.push(site);
            }
        }
        return res;
    }

    private randomSite(): Site {
        const x: number = Math.floor(Math.random() * (this.shape.size[0]));
        const y: number = Math.floor(Math.random() * (this.shape.size[1]));
        return {x, y};
    }
}