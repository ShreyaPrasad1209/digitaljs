"use strict";

import joint from 'jointjs';
import _ from 'lodash';
import Backbone from 'backbone';
import { Vector3vl } from '3vl';
import { Waveform, drawWaveform, defaultSettings, extendSettings } from 'wavecanvas';
import { ResizeSensor } from 'css-element-queries';

function getWireId(wire) {
    const hier = [wire.cid];
    for (let sc = wire.graph.get('subcircuit'); sc != null; sc = sc.graph.get('subcircuit')) {
        hier.push(sc.cid);
    }
    hier.reverse();
    return hier.join('.');
}

function getWireName(wire) {
    const hier = [];
    if (wire.has('netname')) hier.push(wire.get('netname'));
    else {
        const source = wire.source();
        hier.push(source.port);
        const cell = wire.graph.getCell(source.id);
        if (cell.has('label')) hier.push(cell.get('label'));
        else hier.push(source.id);
    }
    for (let sc = wire.graph.get('subcircuit'); sc != null; sc = sc.graph.get('subcircuit')) {
        if (sc.has('label')) hier.push(sc.get('label'));
        else hier.push(sc.id);
    }
    hier.reverse();
    return hier.join('.');
}

export class Monitor {
    constructor(circuit) {
        this._circuit = circuit;
        this._wires = new Map();
        this.listenTo(this._circuit, 'new:paper', (paper) => this.attachTo(paper));
    }
    attachTo(paper) {
        this.listenTo(paper, 'link:monitor', (linkView) => {
            this.addWire(linkView.model);
        });
    }
    addWire(wire) {
        const wireid = getWireId(wire);
        if (this._wires.has(wireid)) return;
        this.listenTo(wire, 'change:signal', this._handleChange);
        const waveform = new Waveform(wire.get('bits'));
        waveform.push(this._circuit.tick, wire.get('signal'));
        this._wires.set(wireid, {wire: wire, waveform: waveform});
        this.trigger('add', wire);
    }
    removeWire(wire) {
        if (typeof wire == 'string') wire = this._wires.get(wire).wire;
        this.trigger('remove', wire);
        this.stopListening(wire);
        this._wires.delete(getWireId(wire));
    }
    _handleChange(wire, signal) {
        this._wires.get(getWireId(wire)).waveform.push(this._circuit.tick, signal);
    }
}

_.extend(Monitor.prototype, Backbone.Events);

export class MonitorView extends Backbone.View {
    initialize() {
        this._width = 800;
        this._settings = extendSettings(defaultSettings, {start: 0, pixelsPerTick: 5, gridStep: 1});
        this._settingsFor = new Map();
        this._live = true;
        this.listenTo(this.model, 'add', this._handleAdd);
        this.listenTo(this.model, 'remove', this._handleRemove);
        this.listenTo(this.model._circuit, 'postUpdateGates', (tick) => { 
            if (this._live) this._settings.start = tick - this._width / this._settings.pixelsPerTick;
            this._settings.present = tick;
            this._drawAll();
        });
        this.render();
        function evt_wireid(e) {
            return $(e.target).closest('tr').attr('wireid');
        }
        this.$el.on('click', 'button[name=remove]', (e) => { this.model.removeWire(evt_wireid(e)); });
        this.$el.on('input', 'select[name=base]', (e) => { this._settingsFor.get(evt_wireid(e)).base = e.target.value; });

        const dragImg = new Image(0,0);
        dragImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        let dragX, dragStart;
        const do_drag = (e) => {
            const offset = e.originalEvent.screenX - dragX;
            this._settings.start = dragStart - offset / this._settings.pixelsPerTick;
        };
        this.$el.on('dragstart', 'canvas', (e) => {
            const dt = e.originalEvent.dataTransfer;
            dt.setData('text/plain', 'dragging'); 
            dt.setDragImage(dragImg, 0, 0);
            dragX = e.originalEvent.screenX;
            dragStart = this._settings.start;
            this._live = false;
            $(document).on('dragover', do_drag);
        });
        this.$el.on('dragend', 'canvas', (e) => {
            $(document).off('dragover', do_drag);
        });
        this.$el.on('wheel', 'canvas', (e) => {
            e.preventDefault();
            const scaling = 2 ** (e.originalEvent.deltaY / 3);
            this._settings.start += e.originalEvent.offsetX / this._settings.pixelsPerTick * (1 - 1 / scaling);
            this._settings.pixelsPerTick *= scaling;
        });
    }
    render() {
        this.$el.html('<div><button name="ppt_up" type="button">+</button><button name="ppt_down">-</button><button name="left">&lt;</button><button name="right">&gt;</button><button name="live">live</button></div><table class="monitor"></table>');
        for (const wobj of this.model._wires.values()) {
            this.$('table').append(this._createRow(wire));
        }
        this.$('button[name=ppt_up]').on('click', (e) => { this._settings.pixelsPerTick *= 2; });
        this.$('button[name=ppt_down]').on('click', (e) => { this._settings.pixelsPerTick /= 2; });
        this.$('button[name=left]').on('click', (e) => { this._live = false; this._settings.start -= this._width / this._settings.pixelsPerTick / 4; });
        this.$('button[name=right]').on('click', (e) => { this._live = false; this._settings.start += this._width / this._settings.pixelsPerTick / 4; });
        this.$('button[name=live]').on('click', (e) => { this._live = true; });
        this._drawAll();
        this._canvasResize();
        new ResizeSensor(this.$el, () => {
            this._canvasResize();
        });
        return this;
    }
    _canvasResize() {
        this._width = Math.max(this.$el.width() - 300, 100);
        this.$('canvas').attr('width', this._width);
    }
    _drawAll() {
        for (const wireid of this.model._wires.keys()) {
            this._draw(wireid);
        }
    }
    _draw(wireid) {
        const canvas = this.$('tr[wireid="'+wireid+'"]').find('canvas');
        const waveform = this.model._wires.get(wireid).waveform;
        drawWaveform(waveform, canvas[0].getContext('2d'), this._settingsFor.get(wireid));
    }
    _handleAdd(wire) {
        const wireid = getWireId(wire);
        this._settingsFor.set(wireid, extendSettings(this._settings, {base: 'hex'}));
        this.$('table').append(this._createRow(wire));
    }
    _handleRemove(wire) {
        const wireid = getWireId(wire);
        this.$('tr[wireid="'+wireid+'"]').remove();
        this._settingsFor.delete(wireid);
    }
    _createRow(wire) {
        const wireid = getWireId(wire);
        const base_sel = wire.get('bits') > 1 ? '<select name="base"><option value="hex">hex</option><option value="oct">oct</option><option value="bin">bin</option></select>' : '';
        const row = $('<tr><td class="name"></td><td>'+base_sel+'</td><td><button type="button" name="remove">✖</button></td><td><canvas class="wavecanvas" height="30" draggable="true"></canvas></td></tr>');
        row.attr('wireid', wireid);
        row.children('td').first().text(getWireName(wire));
        return row;
    }
}